use crate::{
    backend::{Backend, Device, Endpoint},
    windows_contract::{hid_collections, input_report, raw_caps},
    windows_io::{Handle, last},
    windows_registry::{self, Record},
};
use windows_sys::Win32::Devices::HumanInterfaceDevice::*;
pub struct Windows;
fn caps(handle: &Handle) -> Result<Vec<u8>, &'static str> {
    let mut data = 0;
    // SAFETY: live HID metadata handle, output pointer released below on every path.
    if !unsafe { HidD_GetPreparsedData(handle.raw(), &mut data) } {
        return Err(last());
    }
    let checked = (|| {
        let mut caps = HIDP_CAPS::default();
        // SAFETY: preparsed data from this live collection and initialized caps output.
        if unsafe { HidP_GetCaps(data, &mut caps) } != HIDP_STATUS_SUCCESS {
            return Err("unsupported");
        }
        if !raw_caps(
            caps.UsagePage,
            caps.Usage,
            caps.InputReportByteLength,
            caps.OutputReportByteLength,
            caps.FeatureReportByteLength,
        ) || caps.NumberInputButtonCaps != 0
            || caps.NumberOutputButtonCaps != 0
            || caps.NumberInputValueCaps != 1
            || caps.NumberOutputValueCaps != 1
        {
            return Err("unsupported");
        }
        for kind in [HidP_Input, HidP_Output] {
            let mut value = HIDP_VALUE_CAPS::default();
            let mut count = 1;
            // SAFETY: capacity is one caps entry, matching the checked collection count.
            if unsafe { HidP_GetValueCaps(kind, &mut value, &mut count, data) }
                != HIDP_STATUS_SUCCESS
                || count != 1
                || value.ReportID != 0
                || value.BitSize != 8
                || value.ReportCount != 32
            {
                return Err("unsupported");
            }
        }
        Ok(vec![0x60, 0xff, 0x61, 0, 33, 33])
    })();
    // SAFETY: unique preparsed allocation; checked even if caps admission failed.
    if !unsafe { HidD_FreePreparsedData(data) } {
        return Err("io_failed");
    }
    checked
}
fn endpoint(r: Record, descriptor: Vec<u8>) -> Endpoint {
    Endpoint {
        key: r.key(),
        permission_denied: false,
        driver_missing: r.missing,
        vendor: r.identity.vendor,
        product: r.identity.product,
        serial: r.identity.serial,
        descriptor,
        interface_number: r.identity.interface,
    }
}
impl Backend for Windows {
    fn list(&self) -> Result<Vec<Endpoint>, &'static str> {
        let records = windows_registry::interfaces(&GUID_DEVINTERFACE_HID, false)?;
        let listed = hid_collections(
            &records,
            |r| {
                // Zero desired access allows metadata/caps without claiming the keyboard collection.
                let mut h = match Handle::open(&r.path, true, false) {
                    Ok(h) => h,
                    Err("disconnected" | "permission_denied" | "busy") => return Ok(None),
                    Err(e) => return Err(e),
                };
                let admitted = caps(&h);
                h.close()?;
                match admitted {
                    Ok(d) => Ok(Some(d)),
                    Err("unsupported" | "disconnected") => Ok(None),
                    Err(e) => Err(e),
                }
            },
            |working| windows_registry::missing_drivers(false, working),
        )?;
        Ok(listed.into_iter().map(|(r, d)| endpoint(r, d)).collect())
    }

    fn open(&self, expected: &Endpoint) -> Result<Box<dyn Device>, &'static str> {
        if expected.driver_missing {
            return Err("unsupported");
        }
        if !self.list()?.contains(expected) {
            return Err("stale_device");
        }
        let (_, path) = expected.key.rsplit_once('|').ok_or("stale_device")?;
        let mut handle = Handle::open(path, false, false)?;
        let checked = (|| {
            if caps(&handle)? != expected.descriptor {
                return Err("stale_device");
            }
            let mut attrs = HIDD_ATTRIBUTES {
                Size: std::mem::size_of::<HIDD_ATTRIBUTES>() as u32,
                ..Default::default()
            };
            // SAFETY: owned collection handle and correctly initialized attributes output.
            if !unsafe { HidD_GetAttributes(handle.raw(), &mut attrs) } {
                return Err(last());
            }
            if attrs.VendorID != expected.vendor
                || attrs.ProductID != expected.product
                || !self.list()?.contains(expected)
            {
                return Err("stale_device");
            }
            // The owner identity comes from CfgMgr; the opened collection's serial must agree.
            if let Some(serial) = &expected.serial {
                let mut value = [0u16; 126];
                // SAFETY: writable UTF-16 buffer, length in bytes, live collection handle.
                if !unsafe {
                    HidD_GetSerialNumberString(
                        handle.raw(),
                        value.as_mut_ptr().cast(),
                        std::mem::size_of_val(&value) as u32,
                    )
                } {
                    return Err(last());
                }
                let end = value.iter().position(|c| *c == 0).ok_or("io_failed")?;
                if !String::from_utf16(&value[..end])
                    .map_err(|_| "io_failed")?
                    .eq_ignore_ascii_case(serial)
                {
                    return Err("stale_device");
                }
            }
            Ok(())
        })();
        if let Err(e) = checked {
            if handle.close().is_err() {
                std::process::exit(1);
            }
            return Err(e);
        }
        Ok(Box::new(Hid(handle)))
    }
}
struct Hid(Handle);
impl Hid {
    fn read_for(&mut self, ms: u32) -> Result<Option<[u8; 32]>, &'static str> {
        let mut b = [0; 33];
        self.0
            .transfer(&mut b, false, ms)?
            .map(|n| input_report(&b[..n]))
            .transpose()
    }
}
impl Device for Hid {
    fn write(&mut self, b: &[u8; 32]) -> Result<(), &'static str> {
        let mut report = [0; 33];
        report[1..].copy_from_slice(b);
        match self.0.transfer(&mut report, true, 500)? {
            Some(33) => Ok(()),
            None => Err("timeout"),
            _ => Err("io_failed"),
        }
    }
    fn read(&mut self) -> Result<Option<[u8; 32]>, &'static str> {
        self.read_for(50)
    }
    fn pending(&mut self) -> Result<Option<[u8; 32]>, &'static str> {
        self.read_for(0)
    }
    fn close(&mut self) -> Result<(), &'static str> {
        self.0.close()
    }
}
