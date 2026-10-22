use crate::{
    serial::{OpenError, SerialBackend, SerialDevice, SerialEndpoint},
    windows_contract::{self, TouchIo},
    windows_io::{Handle, last},
    windows_registry::{self, Record},
};
use std::mem::size_of;
use windows_sys::Win32::Devices::Communication::*;
pub struct Windows;
// GUID_DEVINTERFACE_COMPORT from ntddser.h; windows-sys places it outside Communication.
const COMPORT: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0x86e0d1e0_8089_11d0_9ce4_08003e301f73);
fn endpoint(r: Record) -> SerialEndpoint {
    SerialEndpoint {
        key: r.key(),
        permission_denied: false,
        driver_missing: r.missing,
        vendor: r.identity.vendor,
        product: r.identity.product,
        serial: r.identity.serial,
        product_name: None,
        interface_number: r.identity.interface,
    }
}
impl SerialBackend for Windows {
    fn list(&self) -> Result<Vec<SerialEndpoint>, &'static str> {
        let mut r = windows_registry::interfaces(&COMPORT, true)?;
        r.extend(windows_registry::missing_drivers(true, &r)?);
        Ok(r.into_iter().map(endpoint).collect())
    }
    fn open(&self, e: &SerialEndpoint) -> Result<Box<dyn SerialDevice>, OpenError> {
        let mut port = open(e)?;
        let configured = (|| {
            recheck(e)?;
            port.set_rate(115200)?;
            if port.rate()? != 115200 {
                return Err("io_failed");
            }
            port.capture = true;
            let timeouts = COMMTIMEOUTS {
                ReadIntervalTimeout: u32::MAX,
                ReadTotalTimeoutMultiplier: 0,
                ReadTotalTimeoutConstant: 0,
                WriteTotalTimeoutMultiplier: 0,
                // Below the helper's 500 ms overlapped wait, so a stalled write completes short (io_failed) before
                // the wait gives up and has to cancel, instead of racing it and exiting the helper.
                WriteTotalTimeoutConstant: 400,
            };
            // SAFETY: initialized timeout structure and owned exclusive COM handle.
            if unsafe { SetCommTimeouts(port.handle.raw(), &timeouts) } == 0 {
                return Err(last());
            }
            port.dtr(true)
        })();
        if let Err(code) = configured {
            if port.close_port().is_err() {
                std::process::exit(1);
            }
            return Err(OpenError {
                code,
                possible: true,
            });
        }
        Ok(Box::new(port))
    }
    fn touch(&self, e: &SerialEndpoint, baud: u64) -> Result<(), OpenError> {
        if e.driver_missing {
            return Err("unsupported".into());
        }
        if e.serial.is_none() {
            return Err("ambiguous_device".into());
        }
        if !matches!(baud, 1200 | 1201) {
            return Err("invalid_request".into());
        }
        let mut port = open(e)?;
        windows_contract::touch(&mut port, baud as u32, || recheck(e)).map_err(|code| OpenError {
            code,
            possible: true,
        })
    }
}
fn recheck(e: &SerialEndpoint) -> Result<(), &'static str> {
    if Windows.list()?.contains(e) {
        Ok(())
    } else {
        Err("stale_device")
    }
}
fn open(e: &SerialEndpoint) -> Result<Port, OpenError> {
    if e.driver_missing {
        return Err("unsupported".into());
    }
    recheck(e)?;
    let (_, path) = e.key.rsplit_once('|').ok_or("stale_device")?;
    Ok(Port {
        handle: Handle::open(path, false, true)?,
        capture: false,
    })
}
struct Port {
    handle: Handle,
    capture: bool,
}
fn state(handle: &Handle) -> Result<DCB, &'static str> {
    let mut dcb = DCB {
        DCBlength: size_of::<DCB>() as u32,
        ..Default::default()
    };
    // SAFETY: live COM handle and initialized DCB output.
    if unsafe { GetCommState(handle.raw(), &mut dcb) } == 0 {
        Err(last())
    } else {
        Ok(dcb)
    }
}
fn raw(dcb: &DCB, baud: u32) -> bool {
    dcb.BaudRate == baud
        && dcb.ByteSize == 8
        && dcb.Parity == NOPARITY
        && dcb.StopBits == ONESTOPBIT
        && dcb._bitfield & 0x7fff == 0x11
}
impl Port {
    fn dtr(&mut self, high: bool) -> Result<(), &'static str> {
        // SAFETY: exclusive live port with DTR handshaking disabled; no borrowed storage.
        if unsafe { EscapeCommFunction(self.handle.raw(), if high { SETDTR } else { CLRDTR }) } != 0
        {
            Ok(())
        } else {
            Err(last())
        }
    }
    fn close_port(&mut self) -> Result<(), &'static str> {
        let line = if self.capture {
            self.capture = false;
            match self.dtr(false) {
                Err("disconnected") => Ok(()),
                r => r,
            }
        } else {
            Ok(())
        };
        let closed = self.handle.close();
        line.and(closed)
    }
    fn read_for(&mut self, ms: u64) -> Result<Option<Vec<u8>>, &'static str> {
        let mut b = vec![0; 4096];
        let n = self
            .handle
            .transfer(&mut b, false, if ms == 0 { 0 } else { 50 })?
            .unwrap_or(0);
        if n == 0 {
            if ms > 0 {
                std::thread::sleep(std::time::Duration::from_millis(ms));
            }
            return Ok(None);
        }
        b.truncate(n);
        Ok(Some(b))
    }
}
impl Drop for Port {
    fn drop(&mut self) {
        if self.close_port().is_err() {
            std::process::exit(1);
        }
    }
}
impl TouchIo for Port {
    fn unconfirmed(&mut self) -> ! {
        std::process::exit(1);
    }
    fn set_rate(&mut self, baud: u32) -> Result<(), &'static str> {
        let mut dcb = state(&self.handle)?;
        dcb.BaudRate = baud;
        dcb.ByteSize = 8;
        dcb.Parity = NOPARITY;
        dcb.StopBits = ONESTOPBIT;
        // fBinary plus DTR enabled, no CTS/DSR/XON/XOFF/RTS flow control, no byte filtering.
        // Keep DTR high while changing baud; only the checked EscapeCommFunction lowers it.
        dcb._bitfield = 0x11;
        // SAFETY: initialized DCB and exclusive port; SetCommState does not retain its pointer.
        if unsafe { SetCommState(self.handle.raw(), &dcb) } == 0 {
            return Err(last());
        }
        if !raw(&state(&self.handle)?, baud) {
            return Err("io_failed");
        }
        Ok(())
    }
    fn rate(&mut self) -> Result<u32, &'static str> {
        Ok(state(&self.handle)?.BaudRate)
    }
    fn clear_dtr(&mut self) -> Result<(), &'static str> {
        self.dtr(false)
    }
    fn close(&mut self) -> Result<(), &'static str> {
        self.close_port()
    }
}
impl SerialDevice for Port {
    fn write(&mut self, bytes: &[u8]) -> Result<(), &'static str> {
        if !(1..=4096).contains(&bytes.len()) {
            return Err("invalid_request");
        }
        let mut b = bytes.to_vec();
        // Do not replay a short or uncertain write; stream loss is explicit.
        match self.handle.transfer(&mut b, true, 500)? {
            Some(n) if n == bytes.len() => Ok(()),
            None => Err("timeout"),
            _ => Err("io_failed"),
        }
    }
    fn read(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        self.read_for(5)
    }
    fn pending(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        self.read_for(0)
    }
    fn close(&mut self) -> Result<(), &'static str> {
        self.close_port()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_readback_requires_every_flow_and_filter_flag_off() {
        let mut d = DCB {
            BaudRate: 115200,
            ByteSize: 8,
            Parity: NOPARITY,
            StopBits: ONESTOPBIT,
            _bitfield: 0x11,
            ..Default::default()
        };
        assert!(raw(&d, 115200));
        for bit in [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] {
            d._bitfield = 0x11 | (1 << bit);
            assert!(!raw(&d, 115200));
        }
    }
}
