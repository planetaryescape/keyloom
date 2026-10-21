//! Shared metadata-only IOKit ownership. No device node is opened here.
use core_foundation::{
    base::{CFType, TCFType},
    number::CFNumber,
    string::CFString,
};
use std::{
    ffi::{c_char, c_void},
    ptr,
};
type Ref = *const c_void;
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    pub fn IOServiceMatching(name: *const c_char) -> *mut c_void;
    pub fn IOServiceGetMatchingServices(
        port: u32,
        matching: *mut c_void,
        iterator: *mut u32,
    ) -> i32;
    pub fn IOIteratorNext(iterator: u32) -> u32;
    fn IOObjectRelease(object: u32) -> i32;
    pub fn IORegistryEntryGetRegistryEntryID(entry: u32, id: *mut u64) -> i32;
    fn IORegistryEntryCreateCFProperty(entry: u32, key: Ref, allocator: Ref, options: u32) -> Ref;
    pub fn IORegistryEntryIDMatching(id: u64) -> *mut c_void;
    pub fn IOServiceGetMatchingService(port: u32, matching: *mut c_void) -> u32;
    #[cfg(feature = "native-serial")]
    fn IORegistryEntryGetParentEntry(entry: u32, plane: *const c_char, parent: *mut u32) -> i32;
}
pub struct Registry(pub u32);
impl Drop for Registry {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns one retained IOKit object, released exactly once.
        unsafe {
            IOObjectRelease(self.0);
        }
    }
}
pub fn property(entry: u32, key: &str) -> Option<CFType> {
    let key = CFString::new(key);
    // SAFETY: entry is retained by the caller; key lives through the call. Create returns ownership.
    let value = unsafe {
        IORegistryEntryCreateCFProperty(entry, key.as_concrete_TypeRef().cast(), ptr::null(), 0)
    };
    if value.is_null() {
        None
    } else {
        // SAFETY: nonnull Create result owns a CF reference; CFType releases it.
        Some(unsafe { CFType::wrap_under_create_rule(value) })
    }
}
pub fn number(entry: u32, key: &str) -> Option<u16> {
    u16::try_from(property(entry, key)?.downcast::<CFNumber>()?.to_i64()?).ok()
}
#[cfg(feature = "native-serial")]
pub fn string(entry: u32, key: &str) -> Option<String> {
    property(entry, key)?
        .downcast::<CFString>()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}
#[cfg(feature = "native-serial")]
pub fn parent(entry: u32) -> Option<Registry> {
    let mut parent = 0;
    // SAFETY: entry is retained; output points to writable storage; successful lookup retains parent.
    if unsafe { IORegistryEntryGetParentEntry(entry, c"IOService".as_ptr(), &mut parent) } == 0
        && parent != 0
    {
        Some(Registry(parent))
    } else {
        None
    }
}
