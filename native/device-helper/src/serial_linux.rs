//! Linux CDC ACM: direct libc ownership, termios2 for exact arbitrary touch rates.
use crate::{
    linux_io::{Fd, errno, io_code, vanished},
    linux_sysfs,
    linux_touch::{self, TouchIo},
    serial::{OpenError, SerialBackend, SerialDevice, SerialEndpoint},
    serial_termios::{raw, verified},
};
use libc::*;
use std::path::Path;
pub struct Linux;
fn endpoint(r: linux_sysfs::Record) -> SerialEndpoint {
    SerialEndpoint {
        key: r.key(),
        permission_denied: crate::linux_io::permission_denied(&r.node),
        vendor: r.vendor,
        product: r.product,
        serial: r.serial,
        product_name: r.product_name,
        interface_number: r.interface,
    }
}
fn recheck(expected: &SerialEndpoint) -> Result<(), &'static str> {
    if Linux.list()?.contains(expected) {
        Ok(())
    } else {
        Err("stale_device")
    }
}
fn acquire(expected: &SerialEndpoint) -> Result<Port, OpenError> {
    recheck(expected)?;
    let (_, path) = expected.key.rsplit_once('|').ok_or("stale_device")?;
    let mut port = Port {
        fd: Fd::open(Path::new(path))?,
        safe_baud: false,
        exclusive: false,
    };
    if let Err(code) = port
        .fd
        .same_node(Path::new(path))
        .and_then(|_| recheck(expected))
    {
        port.release_or_exit();
        return Err(OpenError {
            code,
            possible: true,
        });
    }
    Ok(port)
}
impl SerialBackend for Linux {
    fn list(&self) -> Result<Vec<SerialEndpoint>, &'static str> {
        Ok(
            linux_sysfs::discover(Path::new("/sys/class/tty"), Path::new("/dev"), false)?
                .into_iter()
                .map(endpoint)
                .collect(),
        )
    }
    fn open(&self, expected: &SerialEndpoint) -> Result<Box<dyn SerialDevice>, OpenError> {
        let mut port = acquire(expected)?;
        if let Err(code) = port.configure() {
            if port.safe_baud {
                if SerialDevice::close(&mut port).is_err() {
                    std::process::exit(1);
                }
            } else {
                port.release_or_exit();
            }
            return Err(OpenError {
                code,
                possible: true,
            });
        }
        Ok(Box::new(port))
    }
    fn touch(&self, expected: &SerialEndpoint, baud: u64) -> Result<(), OpenError> {
        if !matches!(baud, 1200 | 1201) {
            return Err("invalid_request".into());
        }
        let mut port = acquire(expected)?;
        linux_touch::sequence(&mut port, baud as u32, || recheck(expected)).map_err(|e| OpenError {
            code: e.code,
            possible: true,
        })
    }
}
fn get(fd: c_int) -> Result<termios, &'static str> {
    let mut v = std::mem::MaybeUninit::uninit();
    // SAFETY: live tty fd, writable termios storage read only on success.
    if unsafe { tcgetattr(fd, v.as_mut_ptr()) } != 0 {
        return Err(io_code(errno()));
    }
    Ok(unsafe { v.assume_init() })
}
fn set(fd: c_int, v: &termios) -> Result<(), &'static str> {
    // SAFETY: initialized termios and owned fd.
    if unsafe { tcsetattr(fd, TCSANOW, v) } == 0 {
        Ok(())
    } else {
        Err(io_code(errno()))
    }
}
fn exclusive(fd: c_int) -> Result<(), &'static str> {
    // SAFETY: no-argument ioctl on an owned tty descriptor.
    if unsafe { ioctl(fd, TIOCEXCL) } == 0 {
        Ok(())
    } else if errno() == EBUSY {
        Err("busy")
    } else {
        Err(io_code(errno()))
    }
}
fn dtr(fd: c_int, high: bool) -> Result<(), &'static str> {
    let bits = TIOCM_DTR;
    // SAFETY: modem-bit ioctls consume a pointer to an initialized integer, not the integer itself.
    let result = unsafe { ioctl(fd, if high { TIOCMBIS } else { TIOCMBIC }, &bits) };
    if result != 0 {
        let e = errno();
        return if !high && vanished(e) {
            Ok(())
        } else {
            Err(io_code(e))
        };
    }
    let mut actual = 0;
    if unsafe { ioctl(fd, TIOCMGET, &mut actual) } != 0 {
        let e = errno();
        return if !high && vanished(e) {
            Ok(())
        } else {
            Err(io_code(e))
        };
    }
    if (actual & TIOCM_DTR != 0) == high {
        Ok(())
    } else {
        Err("io_failed")
    }
}
struct Port {
    fd: Fd,
    safe_baud: bool,
    exclusive: bool,
}
impl Port {
    fn configure(&mut self) -> Result<(), &'static str> {
        let fd = self.fd.raw()?;
        exclusive(fd)?;
        self.exclusive = true;
        set(fd, &raw(get(fd)?)?)?;
        if !verified(&get(fd)?) {
            return Err("io_failed");
        }
        self.safe_baud = true;
        dtr(fd, true)
    }
    fn release_exclusive(&mut self) -> Result<(), &'static str> {
        if !std::mem::take(&mut self.exclusive) {
            return Ok(());
        }
        // SAFETY: no-argument ioctl; the descriptor remains owned until checked close.
        if unsafe { ioctl(self.fd.raw()?, TIOCNXCL) } == 0 || vanished(errno()) {
            Ok(())
        } else {
            Err("io_failed")
        }
    }
    fn release_or_exit(&mut self) {
        let exclusive = self.release_exclusive();
        let closed = self.fd.close();
        if exclusive.and(closed).is_err() {
            std::process::exit(1);
        }
    }
}
impl SerialDevice for Port {
    fn read(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        self.fd.read(50, 4096)
    }
    fn pending(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        self.fd.read(0, 4096)
    }
    fn write(&mut self, bytes: &[u8]) -> Result<(), &'static str> {
        if !(1..=4096).contains(&bytes.len()) {
            return Err("invalid_request");
        }
        self.fd.write(bytes, false)
    }
    fn close(&mut self) -> Result<(), &'static str> {
        let Some(fd) = self.fd.0 else { return Ok(()) };
        let line = dtr(fd, false);
        let exclusive = self.release_exclusive();
        let closed = self.fd.close();
        line.and(exclusive).and(closed)
    }
}
fn get2(fd: c_int) -> Result<termios2, &'static str> {
    let mut value = std::mem::MaybeUninit::uninit();
    // SAFETY: kernel termios2 ABI from libc (not libc::termios); only read on success.
    if unsafe { ioctl(fd, TCGETS2, value.as_mut_ptr()) } != 0 {
        return Err(io_code(errno()));
    }
    Ok(unsafe { value.assume_init() })
}
impl TouchIo for Port {
    fn exclusive(&mut self) -> Result<(), &'static str> {
        exclusive(self.fd.raw()?)?;
        self.exclusive = true;
        Ok(())
    }
    fn set_rate(&mut self, baud: u32) -> Result<(), &'static str> {
        let fd = self.fd.raw()?;
        let mut value = get2(fd)?;
        // HUPCL would let the tty layer lower DTR again on final close. Own that transition explicitly.
        value.c_cflag = (value.c_cflag & !(CBAUD | CIBAUD | HUPCL | CRTSCTS))
            | BOTHER
            | (BOTHER << IBSHIFT)
            | CLOCAL;
        value.c_ispeed = baud;
        value.c_ospeed = baud;
        // SAFETY: exact Linux termios2 ABI, borrowed initialized struct.
        if unsafe { ioctl(fd, TCSETS2, &value) } == 0 {
            Ok(())
        } else {
            Err(io_code(errno()))
        }
    }
    fn rate(&mut self) -> Result<(u32, u32), &'static str> {
        let v = get2(self.fd.raw()?)?;
        if v.c_cflag & HUPCL != 0 {
            return Err("io_failed");
        }
        Ok((v.c_ispeed, v.c_ospeed))
    }
    fn clear_dtr(&mut self) -> Result<(), &'static str> {
        dtr(self.fd.raw()?, false)
    }
    fn close(&mut self) -> Result<(), &'static str> {
        self.release_or_exit();
        Ok(())
    }
}
#[cfg(test)]
#[path = "serial_linux_tests.rs"]
mod tests;
