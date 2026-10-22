//! Read-only SetupAPI/CfgMgr metadata. Never opens a COM port or performs device I/O.
use crate::windows_contract::{Identity, Tree, com_path, endpoint_key, usb_owner};
use std::{mem::size_of, ptr};
use windows_sys::{
    Win32::{Devices::DeviceAndDriverInstallation::*, Foundation::*, System::Registry::*},
    core::GUID,
};

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
fn text(s: &[u16]) -> Result<String, &'static str> {
    let end = s.iter().position(|v| *v == 0).ok_or("io_failed")?;
    String::from_utf16(&s[..end]).map_err(|_| "io_failed")
}
pub struct Registry;
impl Tree for Registry {
    fn instance(&self, node: u32) -> Result<String, &'static str> {
        let mut id = [0u16; 512];
        // SAFETY: writable UTF-16 buffer with capacity in WCHARs; devinst is supplied by SetupAPI.
        if unsafe { CM_Get_Device_IDW(node, id.as_mut_ptr(), id.len() as u32, 0) } != CR_SUCCESS {
            return Err("disconnected");
        }
        text(&id)
    }
    fn unique_id(&self, node: u32) -> bool {
        let mut caps = 0u32;
        let mut len = 4;
        let mut kind = 0;
        // SAFETY: DWORD storage and its exact byte size; read-only property request.
        unsafe {
            CM_Get_DevNode_Registry_PropertyW(
                node,
                CM_DRP_CAPABILITIES,
                &mut kind,
                (&mut caps as *mut u32).cast(),
                &mut len,
                0,
            ) == CR_SUCCESS
                && kind == REG_DWORD
                && caps & CM_DEVCAP_UNIQUEID != 0
        }
    }
    fn parent(&self, node: u32) -> Result<u32, &'static str> {
        let mut parent = 0;
        // SAFETY: initialized devinst and writable parent output.
        if unsafe { CM_Get_Parent(&mut parent, node, 0) } == CR_SUCCESS {
            Ok(parent)
        } else {
            Err("unsupported")
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub identity: Identity,
    pub instance: String,
    pub path: String,
    pub missing: bool,
}
impl Record {
    pub fn key(&self) -> String {
        endpoint_key(&self.instance, &self.path)
    }
}
struct Set(HDEVINFO);
impl Drop for Set {
    fn drop(&mut self) {
        // SAFETY: this wrapper is the only owner of the SetupAPI device-info set.
        if unsafe { SetupDiDestroyDeviceInfoList(self.0) } == 0 {
            std::process::exit(1);
        }
    }
}
fn port(set: HDEVINFO, info: &SP_DEVINFO_DATA) -> Result<String, &'static str> {
    // SAFETY: live set/member; opens only the device's read-only registry key, not its COM port.
    let key =
        unsafe { SetupDiOpenDevRegKey(set, info, DICS_FLAG_GLOBAL, 0, DIREG_DEV, KEY_QUERY_VALUE) };
    if key == INVALID_HANDLE_VALUE {
        return Err("unsupported");
    }
    let mut value = [0u16; 64];
    let mut bytes = size_of_val(&value) as u32;
    let mut kind = 0;
    // SAFETY: live registry key, NUL-terminated name, correctly sized output buffer.
    let result = unsafe {
        RegQueryValueExW(
            key,
            wide("PortName").as_ptr(),
            ptr::null(),
            &mut kind,
            value.as_mut_ptr().cast(),
            &mut bytes,
        )
    };
    // SAFETY: sole registry handle, released once after the property call.
    if unsafe { RegCloseKey(key) } != ERROR_SUCCESS {
        return Err("io_failed");
    }
    if result != ERROR_SUCCESS || kind != REG_SZ {
        return Err("unsupported");
    }
    com_path(&text(&value)?)
}
pub fn interfaces(guid: &GUID, serial: bool) -> Result<Vec<Record>, &'static str> {
    // SAFETY: valid class GUID, no parent window, read-only enumeration of present interfaces.
    let raw = unsafe {
        SetupDiGetClassDevsW(
            guid,
            ptr::null(),
            ptr::null_mut(),
            DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
        )
    };
    if raw == INVALID_HANDLE_VALUE as isize {
        return Err("io_failed");
    }
    let set = Set(raw);
    let mut records = Vec::new();
    for index in 0..4096 {
        let mut interface = SP_DEVICE_INTERFACE_DATA {
            cbSize: size_of::<SP_DEVICE_INTERFACE_DATA>() as u32,
            ..Default::default()
        };
        // SAFETY: live set, matching class GUID and correctly initialized output size.
        if unsafe { SetupDiEnumDeviceInterfaces(set.0, ptr::null(), guid, index, &mut interface) }
            == 0
        {
            // SAFETY: thread-local error read immediately after failed enumeration.
            return if unsafe { GetLastError() } == ERROR_NO_MORE_ITEMS {
                Ok(records)
            } else {
                Err("io_failed")
            };
        }
        let mut required = 0;
        // SAFETY: sizing call with null buffer; SetupAPI writes only required length.
        unsafe {
            SetupDiGetDeviceInterfaceDetailW(
                set.0,
                &interface,
                ptr::null_mut(),
                0,
                &mut required,
                ptr::null_mut(),
            )
        };
        if !(8..=65536).contains(&required) {
            return Err("capacity");
        }
        // usize allocation supplies alignment required by SP_DEVICE_INTERFACE_DETAIL_DATA_W.
        let mut storage = vec![0usize; (required as usize).div_ceil(size_of::<usize>())];
        let detail = storage
            .as_mut_ptr()
            .cast::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>();
        let mut info = SP_DEVINFO_DATA {
            cbSize: size_of::<SP_DEVINFO_DATA>() as u32,
            ..Default::default()
        };
        // SAFETY: aligned allocated storage of at least required bytes, both cbSize fields initialized.
        unsafe { (*detail).cbSize = size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32 };
        // SAFETY: detail buffer and device info output outlive this synchronous metadata call.
        if unsafe {
            SetupDiGetDeviceInterfaceDetailW(
                set.0,
                &interface,
                detail,
                required,
                ptr::null_mut(),
                &mut info,
            )
        } == 0
        {
            return Err("io_failed");
        }
        let identity = match usb_owner(&Registry, info.DevInst) {
            Ok(i) => i,
            Err("unsupported" | "disconnected") => continue,
            Err(e) => return Err(e),
        };
        let path = if serial {
            match port(set.0, &info) {
                Ok(p) => p,
                Err("unsupported") => continue,
                Err(e) => return Err(e),
            }
        } else {
            // SAFETY: DevicePath begins at byte 4; required includes the terminating WCHAR.
            let chars = unsafe {
                std::slice::from_raw_parts(
                    ptr::addr_of!((*detail).DevicePath).cast::<u16>(),
                    (required as usize - 4) / 2,
                )
            };
            text(chars)?
        };
        records.push(Record {
            identity,
            instance: Registry.instance(info.DevInst)?,
            path,
            missing: false,
        });
    }
    Err("capacity")
}
// A failed driver devnode may have no interface to enumerate. Surface known keyboard failures
// as non-openable list records, rather than silently reporting an absent keyboard.
pub fn missing_drivers(serial: bool, working: &[Record]) -> Result<Vec<Record>, &'static str> {
    // SAFETY: read-only enumeration, all present devnodes; filter to USB owners below.
    let raw = unsafe {
        SetupDiGetClassDevsW(
            ptr::null(),
            ptr::null(),
            ptr::null_mut(),
            DIGCF_PRESENT | DIGCF_ALLCLASSES,
        )
    };
    if raw == INVALID_HANDLE_VALUE as isize {
        return Err("io_failed");
    }
    let set = Set(raw);
    let mut result = Vec::new();
    for index in 0..16384 {
        let mut info = SP_DEVINFO_DATA {
            cbSize: size_of::<SP_DEVINFO_DATA>() as u32,
            ..Default::default()
        };
        // SAFETY: live set, initialized output size.
        if unsafe { SetupDiEnumDeviceInfo(set.0, index, &mut info) } == 0 {
            // SAFETY: immediate thread-local error after failed enumeration.
            return if unsafe { GetLastError() } == ERROR_NO_MORE_ITEMS {
                Ok(result)
            } else {
                Err("io_failed")
            };
        }
        let mut status = 0;
        let mut problem = 0;
        // SAFETY: writable status outputs for the enumerated devinst.
        if unsafe { CM_Get_DevNode_Status(&mut status, &mut problem, info.DevInst, 0) }
            != CR_SUCCESS
            || !matches!(
                problem,
                CM_PROB_FAILED_INSTALL
                    | CM_PROB_DRIVER_FAILED_LOAD
                    | CM_PROB_DISABLED_SERVICE
                    | CM_PROB_FAILED_ADD
            )
        {
            continue;
        }
        let Ok(identity) = usb_owner(&Registry, info.DevInst) else {
            continue;
        };
        let known = if serial {
            identity.vendor == 0x16c0 && matches!(identity.product, 0x27db | 0x27d9)
        } else {
            identity.vendor == 0x3297 && matches!(identity.product, 0x1969 | 0x1972)
        };
        if !known
            || working
                .iter()
                .chain(result.iter())
                .any(|r: &Record| r.identity.instance == identity.instance)
        {
            continue;
        }
        result.push(Record {
            instance: identity.instance.clone(),
            identity,
            path: String::new(),
            missing: true,
        });
    }
    Err("capacity")
}
