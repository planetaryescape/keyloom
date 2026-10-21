//! Small native adapter, not a translation/copy of HIDAPI. Registry reads never call
//! IOHIDDeviceOpen. The owner pumps one runloop; callbacks never block or silently drop.
use crate::backend::{Backend, Device, Endpoint, raw_descriptor};
use core_foundation::{
    base::{CFType, TCFType},
    data::CFData,
    number::CFNumber,
    string::CFString,
};
use std::{
    cell::UnsafeCell,
    collections::VecDeque,
    ffi::{c_char, c_void},
    ptr,
    rc::Rc,
};

type Ref = *const c_void;
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOServiceMatching(name: *const c_char) -> *mut c_void;
    fn IOServiceGetMatchingServices(port: u32, matching: *mut c_void, iterator: *mut u32) -> i32;
    fn IOIteratorNext(iterator: u32) -> u32;
    fn IOObjectRelease(object: u32) -> i32;
    fn IORegistryEntryGetRegistryEntryID(entry: u32, id: *mut u64) -> i32;
    fn IORegistryEntryCreateCFProperty(entry: u32, key: Ref, allocator: Ref, options: u32) -> Ref;
    fn IORegistryEntryIDMatching(id: u64) -> *mut c_void;
    fn IOServiceGetMatchingService(port: u32, matching: *mut c_void) -> u32;
    fn IOHIDDeviceCreate(allocator: Ref, service: u32) -> Ref;
    fn IOHIDDeviceOpen(device: Ref, options: u32) -> i32;
    fn IOHIDDeviceClose(device: Ref, options: u32) -> i32;
    fn IOHIDDeviceScheduleWithRunLoop(device: Ref, runloop: Ref, mode: Ref);
    fn IOHIDDeviceUnscheduleFromRunLoop(device: Ref, runloop: Ref, mode: Ref);
    fn IOHIDDeviceRegisterInputReportCallback(
        device: Ref,
        buffer: *mut u8,
        len: isize,
        callback: Option<
            unsafe extern "C" fn(*mut c_void, i32, *mut c_void, u32, u32, *mut u8, isize),
        >,
        context: *mut c_void,
    );
    fn IOHIDDeviceRegisterRemovalCallback(
        device: Ref,
        callback: Option<unsafe extern "C" fn(*mut c_void, i32, *mut c_void)>,
        context: *mut c_void,
    );
    fn IOHIDDeviceSetReport(device: Ref, kind: u32, id: isize, bytes: *const u8, len: isize)
    -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRunLoopGetCurrent() -> Ref;
    fn CFRunLoopRunInMode(mode: Ref, seconds: f64, once: u8) -> i32;
    static kCFRunLoopDefaultMode: Ref;
}
struct Registry(u32);
impl Drop for Registry {
    fn drop(&mut self) {
        unsafe {
            IOObjectRelease(self.0);
        }
    }
}
fn property(entry: u32, key: &str) -> Option<CFType> {
    let key = CFString::new(key);
    let value = unsafe {
        IORegistryEntryCreateCFProperty(entry, key.as_concrete_TypeRef().cast(), ptr::null(), 0)
    };
    if value.is_null() {
        None
    } else {
        Some(unsafe { CFType::wrap_under_create_rule(value) })
    }
}
fn number(entry: u32, key: &str) -> Option<u16> {
    u16::try_from(property(entry, key)?.downcast::<CFNumber>()?.to_i64()?).ok()
}
fn endpoint(entry: u32) -> Option<Endpoint> {
    if number(entry, "PrimaryUsagePage")? != 0xff60 || number(entry, "PrimaryUsage")? != 0x61 {
        return None;
    }
    let data = property(entry, "ReportDescriptor")?.downcast::<CFData>()?;
    if data.len() > 4096 {
        return None;
    }
    let descriptor = data.bytes().to_vec();
    if !raw_descriptor(&descriptor) {
        return None;
    }
    let mut id = 0;
    if unsafe { IORegistryEntryGetRegistryEntryID(entry, &mut id) } != 0 {
        return None;
    }
    let serial = property(entry, "SerialNumber")
        .and_then(|v| v.downcast::<CFString>())
        .map(|v| v.to_string());
    if serial.as_ref().is_some_and(|v| v.len() > 256) {
        return None;
    }
    Some(Endpoint {
        key: id.to_string(),
        vendor: number(entry, "VendorID")?,
        product: number(entry, "ProductID")?,
        serial,
        descriptor,
    })
}
pub struct Macos;
impl Backend for Macos {
    fn list(&self) -> Result<Vec<Endpoint>, &'static str> {
        let mut iterator = 0;
        if unsafe {
            IOServiceGetMatchingServices(
                0,
                IOServiceMatching(c"IOHIDDevice".as_ptr()),
                &mut iterator,
            )
        } != 0
        {
            return Err("io_failed");
        }
        let iterator = Registry(iterator);
        let mut endpoints = Vec::new();
        loop {
            let entry = unsafe { IOIteratorNext(iterator.0) };
            if entry == 0 {
                break;
            }
            let entry = Registry(entry);
            if let Some(value) = endpoint(entry.0) {
                endpoints.push(value);
                if endpoints.len() > 256 {
                    return Err("capacity");
                }
            }
        }
        Ok(endpoints)
    }
    fn open(&self, expected: &Endpoint) -> Result<Box<dyn Device>, &'static str> {
        let id = expected.key.parse().map_err(|_| "stale_device")?;
        let entry = unsafe { IOServiceGetMatchingService(0, IORegistryEntryIDMatching(id)) };
        if entry == 0 {
            return Err("stale_device");
        }
        let entry = Registry(entry);
        if endpoint(entry.0).as_ref() != Some(expected) {
            return Err("stale_device");
        }
        let raw = unsafe { IOHIDDeviceCreate(ptr::null(), entry.0) };
        if raw.is_null() {
            return Err("not_found");
        }
        let handle = unsafe { CFType::wrap_under_create_rule(raw) };
        // kIOHIDOptionsTypeNone: never seize the ordinary keyboard.
        let result = unsafe { IOHIDDeviceOpen(raw, 0) };
        if result != 0 {
            // IOReturn.h: NotPrivileged / NotPermitted / ExclusiveAccess / NoDevice.
            return Err(match result as u32 {
                0xe00002c1 | 0xe00002e2 => "permission_denied",
                0xe00002c5 => "busy",
                0xe00002c0 => "not_found",
                _ => "io_failed",
            });
        }
        let device = Box::new(MacDevice {
            handle,
            buffer: Rc::new(UnsafeCell::new([0; 33])),
            state: Rc::new(UnsafeCell::new(CallbackState {
                queue: VecDeque::new(),
                failure: None,
            })),
            runloop: unsafe { CFRunLoopGetCurrent() },
            close_attempted: false,
        });
        let context = device.state.get().cast();
        unsafe {
            IOHIDDeviceRegisterInputReportCallback(
                raw,
                device.buffer.get().cast(),
                33,
                Some(report),
                context,
            );
            IOHIDDeviceRegisterRemovalCallback(raw, Some(removed), context);
            IOHIDDeviceScheduleWithRunLoop(raw, device.runloop, kCFRunLoopDefaultMode);
        }
        // Registry IDs do not survive remove/replug. Recheck after the operational open too.
        if endpoint(entry.0).as_ref() != Some(expected) {
            return Err("stale_device");
        }
        Ok(device)
    }
}
struct CallbackState {
    queue: VecDeque<[u8; 32]>,
    failure: Option<&'static str>,
}
struct MacDevice {
    handle: CFType,
    buffer: Rc<UnsafeCell<[u8; 33]>>,
    state: Rc<UnsafeCell<CallbackState>>,
    runloop: Ref,
    close_attempted: bool,
}
unsafe extern "C" fn report(
    context: *mut c_void,
    result: i32,
    _sender: *mut c_void,
    _kind: u32,
    id: u32,
    bytes: *mut u8,
    len: isize,
) {
    // Only invoked on this owner's runloop while the boxed context/buffer remain alive.
    let device = unsafe { &mut *context.cast::<CallbackState>() };
    if device.failure.is_some() {
        return;
    }
    if result != 0 {
        device.failure = Some("io_failed");
        return;
    }
    if id != 0 || len != 32 || bytes.is_null() {
        device.failure = Some("protocol_error");
        return;
    }
    if device.queue.len() >= 510 {
        device.failure = Some("overflow");
        return;
    }
    let mut packet = [0; 32];
    unsafe {
        ptr::copy_nonoverlapping(bytes, packet.as_mut_ptr(), 32);
    }
    device.queue.push_back(packet);
}
unsafe extern "C" fn removed(context: *mut c_void, _result: i32, _sender: *mut c_void) {
    unsafe {
        (*context.cast::<CallbackState>()).failure = Some("disconnected");
    }
}
impl Device for MacDevice {
    fn read(&mut self) -> Result<Option<[u8; 32]>, &'static str> {
        if let Some(bytes) = self.pending()? {
            return Ok(Some(bytes));
        }
        unsafe {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, 1);
        }
        self.pending()
    }
    fn pending(&mut self) -> Result<Option<[u8; 32]>, &'static str> {
        // No callback runs here: only CFRunLoopRunInMode invokes it on this same owner.
        let state = unsafe { &mut *self.state.get() };
        if let Some(bytes) = state.queue.pop_front() {
            return Ok(Some(bytes));
        }
        if let Some(error) = state.failure {
            return Err(error);
        }
        Ok(None)
    }
    fn write(&mut self, bytes: &[u8; 32]) -> Result<(), &'static str> {
        if let Some(error) = unsafe { (*self.state.get()).failure } {
            return Err(error);
        }
        // IOKit has a separate report-ID argument. No hidraw/HIDAPI prefix here.
        if unsafe { IOHIDDeviceSetReport(self.handle.as_CFTypeRef(), 1, 0, bytes.as_ptr(), 32) }
            != 0
        {
            return Err("io_failed");
        }
        Ok(())
    }
    fn close(&mut self) -> Result<(), &'static str> {
        if self.close_attempted {
            return Ok(());
        }
        self.close_attempted = true;
        let result = unsafe {
            let raw = self.handle.as_CFTypeRef();
            IOHIDDeviceUnscheduleFromRunLoop(raw, self.runloop, kCFRunLoopDefaultMode);
            IOHIDDeviceRegisterInputReportCallback(
                raw,
                self.buffer.get().cast(),
                33,
                None,
                ptr::null_mut(),
            );
            IOHIDDeviceRegisterRemovalCallback(raw, None, ptr::null_mut());
            IOHIDDeviceClose(raw, 0)
        };
        if result != 0 {
            return Err("io_failed");
        }
        Ok(())
    }
}
impl Drop for MacDevice {
    fn drop(&mut self) {
        if !self.close_attempted && self.close().is_err() {
            std::process::exit(1);
        }
    }
}
