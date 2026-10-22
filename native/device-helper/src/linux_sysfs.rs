//! Metadata only. Never open a dev node while enumerating.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub device: PathBuf,
    pub node: PathBuf,
    pub vendor: u16,
    pub product: u16,
    pub serial: Option<String>,
    pub product_name: Option<String>,
    pub interface: Option<u8>,
    pub descriptor: Vec<u8>,
}
impl Record {
    pub fn key(&self) -> String {
        format!("{}|{}", self.device.display(), self.node.display())
    }
}
fn text(path: &Path) -> io::Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s.trim().to_owned()).filter(|s| !s.is_empty())),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}
fn hex(path: &Path) -> io::Result<Option<u16>> {
    match fs::read_to_string(path) {
        Ok(s) => u16::from_str_radix(s.trim(), 16)
            .map(Some)
            .map_err(|_| io::Error::from(io::ErrorKind::InvalidData)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}
fn record(class: &Path, dev: &Path, name: &str, hid: bool) -> io::Result<Option<Record>> {
    let device = fs::canonicalize(class.join(name).join("device"))?;
    let descriptor = if hid {
        // HID_ID/HID_UNIQ are not USB ownership: only read the HID metadata here.
        fs::read(device.join("uevent"))?;
        fs::read(device.join("report_descriptor"))?
    } else {
        vec![]
    };
    let mut interface = None;
    for parent in device.ancestors().take(128) {
        // Stop at the first USB device, even when its serial is absent. Never borrow a hub's identity.
        let vendor = hex(&parent.join("idVendor"))?;
        let product = hex(&parent.join("idProduct"))?;
        if vendor.is_some() || product.is_some() {
            return Ok(match (vendor, product) {
                (Some(vendor), Some(product)) => Some(Record {
                    device: device.clone(),
                    node: dev.join(name),
                    vendor,
                    product,
                    serial: text(&parent.join("serial"))?,
                    product_name: text(&parent.join("product"))?,
                    interface,
                    descriptor,
                }),
                _ => None,
            });
        }
        if interface.is_none() {
            interface = hex(&parent.join("bInterfaceNumber"))?.and_then(|n| u8::try_from(n).ok());
        }
    }
    Ok(None)
}
fn code(e: io::Error) -> &'static str {
    if e.kind() == io::ErrorKind::PermissionDenied {
        "permission_denied"
    } else {
        "io_failed"
    }
}
pub fn discover(class: &Path, dev: &Path, hid: bool) -> Result<Vec<Record>, &'static str> {
    let entries = match fs::read_dir(class) {
        Ok(v) => v,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(code(e)),
    };
    let prefix = if hid { "hidraw" } else { "ttyACM" };
    let mut result = vec![];
    for entry in entries {
        let entry = entry.map_err(code)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name
            .strip_prefix(prefix)
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()))
        {
            continue;
        }
        match record(class, dev, name, hid) {
            Ok(Some(record)) => result.push(record),
            Ok(None) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {} // disconnect/dangling link
            Err(e) => return Err(code(e)),
        }
        if result.len() > 256 {
            return Err("capacity");
        }
    }
    result.sort_by_key(Record::key);
    Ok(result)
}
// hidraw writes need the ID byte even for an unnumbered report; reads do not.
pub fn output_report(payload: &[u8; 32]) -> [u8; 33] {
    let mut report = [0; 33];
    report[1..].copy_from_slice(payload);
    report
}
pub fn input_report(bytes: &[u8]) -> Result<[u8; 32], &'static str> {
    bytes.try_into().map_err(|_| "io_failed")
}

#[cfg(test)]
#[path = "linux_sysfs_tests.rs"]
mod tests;
