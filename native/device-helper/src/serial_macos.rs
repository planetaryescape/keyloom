//! Direct CDC ownership; no serialport implementation or background reader.
use crate::{
    registry::*,
    serial::{OpenError, SerialBackend, SerialDevice, SerialEndpoint},
};
use libc::*;
use std::{
    ffi::CString,
    os::fd::RawFd,
    time::{Duration, Instant},
};

#[derive(Default, Clone)]
struct Properties {
    vendor: Option<u16>,
    product: Option<u16>,
    serial: Option<String>,
    product_name: Option<String>,
    interface: Option<u8>,
}
struct Record {
    id: u64,
    path: Option<String>,
    parents: Vec<Properties>,
}
fn endpoint(record: Record) -> Option<SerialEndpoint> {
    let path = record
        .path
        .filter(|s| s.starts_with("/dev/cu.") && !s.contains('\0'))?;
    let usb = record
        .parents
        .iter()
        .find(|p| p.vendor.is_some() && p.product.is_some())?;
    Some(SerialEndpoint {
        key: format!("{}:{path}", record.id),
        vendor: usb.vendor?,
        product: usb.product?,
        serial: record
            .parents
            .iter()
            .find_map(|p| p.serial.as_ref().filter(|s| !s.is_empty()).cloned()),
        product_name: record
            .parents
            .iter()
            .find_map(|p| p.product_name.as_ref().filter(|s| !s.is_empty()).cloned()),
        interface_number: record.parents.iter().find_map(|p| p.interface),
    })
}
fn sorted(mut endpoints: Vec<SerialEndpoint>) -> Result<Vec<SerialEndpoint>, &'static str> {
    if endpoints.len() > 256 {
        return Err("capacity");
    }
    endpoints.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(endpoints)
}
fn registry_endpoint(entry: u32) -> Result<Option<SerialEndpoint>, &'static str> {
    let mut id = 0;
    // SAFETY: caller retains entry and id points to writable storage.
    if unsafe { IORegistryEntryGetRegistryEntryID(entry, &mut id) } != 0 {
        return Err("io_failed");
    }
    let path = string(entry, "IOCalloutDevice");
    if path.is_none() {
        return Ok(None);
    }
    let mut parents = Vec::new();
    let mut current = parent(entry);
    while let Some(entry) = current {
        if parents.len() >= 128 {
            return Err("capacity");
        }
        parents.push(Properties {
            vendor: number(entry.0, "idVendor"),
            product: number(entry.0, "idProduct"),
            serial: string(entry.0, "USB Serial Number"),
            product_name: string(entry.0, "USB Product Name"),
            interface: number(entry.0, "bInterfaceNumber").and_then(|n| u8::try_from(n).ok()),
        });
        current = parent(entry.0);
    }
    Ok(endpoint(Record { id, path, parents }))
}
fn resolve_endpoint(id: u64) -> Result<Option<SerialEndpoint>, &'static str> {
    // SAFETY: matching dictionary is consumed; returned nonzero service is retained for Registry.
    let entry = unsafe { IOServiceGetMatchingService(0, IORegistryEntryIDMatching(id)) };
    if entry == 0 {
        return Ok(None);
    }
    let entry = Registry(entry);
    registry_endpoint(entry.0)
}
fn check_endpoint(
    expected: &SerialEndpoint,
    mut resolve: impl FnMut() -> Result<Option<SerialEndpoint>, &'static str>,
) -> Result<(), &'static str> {
    if resolve()?.as_ref() == Some(expected) {
        Ok(())
    } else {
        Err("stale_device")
    }
}
pub struct Macos;
impl SerialBackend for Macos {
    fn list(&self) -> Result<Vec<SerialEndpoint>, &'static str> {
        let mut iterator = 0;
        // SAFETY: matching dictionary is consumed by IOKit; iterator points to writable storage.
        if unsafe {
            IOServiceGetMatchingServices(
                0,
                IOServiceMatching(c"IOSerialBSDClient".as_ptr()),
                &mut iterator,
            )
        } != 0
        {
            return Err("io_failed");
        }
        let iterator = Registry(iterator);
        let mut endpoints = Vec::new();
        loop {
            // SAFETY: iterator is retained; each nonzero returned service is retained for Registry.
            let entry = unsafe { IOIteratorNext(iterator.0) };
            if entry == 0 {
                break;
            }
            let entry = Registry(entry);
            if let Some(value) = registry_endpoint(entry.0)? {
                endpoints.push(value);
                if endpoints.len() > 256 {
                    return Err("capacity");
                }
            }
        }
        sorted(endpoints)
    }
    fn open(&self, expected: &SerialEndpoint) -> Result<Box<dyn SerialDevice>, OpenError> {
        let (id, path) = expected.key.split_once(':').ok_or("stale_device")?;
        let id = id.parse().map_err(|_| "stale_device")?;
        let mut resolve = || resolve_endpoint(id);
        check_endpoint(expected, &mut resolve)?;
        let path = CString::new(path).map_err(|_| "stale_device")?;
        // SAFETY: path is NUL terminated and lives through open; success transfers a unique fd below.
        let fd = unsafe { open(path.as_ptr(), O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC) };
        if fd < 0 {
            return Err(open_code(errno()).into());
        }
        let mut device = Port {
            fd: Some(fd),
            hungup: false,
        };
        // Open itself can assert DTR. Every subsequent failure has uncertain effects, even before configuration.
        initialize(
            &mut FdConfig(fd),
            || check_endpoint(expected, &mut resolve),
            |safe_baud| {
                let result = if safe_baud {
                    device.close()
                } else {
                    device.abandon()
                };
                // Keep the owner's lease until process exit when cleanup cannot confirm release.
                if result.is_err() {
                    std::process::exit(1);
                }
            },
        )?;
        Ok(Box::new(device))
    }
}
fn errno() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
}
fn open_code(code: i32) -> &'static str {
    match code {
        EACCES | EPERM => "permission_denied",
        EBUSY => "busy",
        ENOENT | ENXIO | ENODEV => "not_found",
        _ => "io_failed",
    }
}
fn io_code(code: i32) -> &'static str {
    match code {
        EPIPE | EIO | ENXIO | ENODEV => "disconnected",
        _ => "io_failed",
    }
}
// Darwin sys/termios.h also defines DTR/DSR/DCD flow bits absent from libc's constants.
// Disable them so inherited flow control cannot drive DTR behind the owner's checked transitions.
const HARDWARE_FLOW: tcflag_t = CRTSCTS | 0x0004_0000 | 0x0008_0000 | 0x0010_0000;
fn raw(mut value: termios) -> Result<termios, &'static str> {
    // SAFETY: value is an initialized termios; libc mutates only that struct.
    unsafe {
        cfmakeraw(&mut value);
    }
    value.c_cflag = (value.c_cflag & !(CSIZE | PARENB | PARODD | CSTOPB | HARDWARE_FLOW | HUPCL))
        | CS8
        | CLOCAL
        | CREAD;
    value.c_iflag &= !(IXON | IXOFF | IXANY);
    value.c_cc[VMIN] = 0;
    value.c_cc[VTIME] = 0;
    // SAFETY: initialized writable termios; standard B115200 is valid on macOS.
    let speeds = unsafe {
        (
            cfsetispeed(&mut value, B115200),
            cfsetospeed(&mut value, B115200),
        )
    };
    if speeds != (0, 0) {
        return Err("io_failed");
    }

    Ok(value)
}
fn verified(value: &termios) -> bool {
    // SAFETY: value is initialized by tcgetattr or the pure builder.
    let speeds = unsafe { (cfgetispeed(value), cfgetospeed(value)) };
    speeds == (B115200, B115200)
        && value.c_cflag
            & (CSIZE | PARENB | PARODD | CSTOPB | HARDWARE_FLOW | HUPCL | CLOCAL | CREAD)
            == CS8 | CLOCAL | CREAD
        && value.c_iflag & (BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON | IXOFF | IXANY)
            == 0
        && value.c_oflag & OPOST == 0
        && value.c_lflag & (ECHO | ECHONL | ICANON | ISIG | IEXTEN) == 0
        && value.c_cc[VMIN] == 0
        && value.c_cc[VTIME] == 0
}
trait Config {
    fn exclusive(&mut self) -> Result<(), &'static str>;
    fn get(&mut self) -> Result<termios, &'static str>;
    fn set(&mut self, value: &termios) -> Result<(), &'static str>;
    fn dtr(&mut self) -> Result<(), &'static str>;
    fn modem(&mut self) -> Result<c_int, &'static str>;
}
fn configure(io: &mut impl Config, safe_baud: &mut bool) -> Result<(), &'static str> {
    io.exclusive()?;
    let value = raw(io.get()?)?;
    io.set(&value)?;
    if !verified(&io.get()?) {
        return Err("io_failed");
    }
    *safe_baud = true;
    io.dtr()?;
    if io.modem()? & TIOCM_DTR == 0 {
        return Err("io_failed");
    }
    Ok(())
}
fn initialize(
    io: &mut impl Config,
    recheck: impl FnOnce() -> Result<(), &'static str>,
    mut cleanup: impl FnMut(bool),
) -> Result<(), OpenError> {
    let mut safe_baud = false;
    recheck()
        .and_then(|_| configure(io, &mut safe_baud))
        .map_err(|code| {
            cleanup(safe_baud);
            OpenError {
                code,
                possible: true,
            }
        })
}
struct FdConfig(RawFd);
fn control(fd: RawFd, request: c_int) -> Result<(), &'static str> {
    // SAFETY: fd is owned and live; these no-argument tty requests do not dereference extra arguments.
    if unsafe { ioctl(fd, request as c_ulong) } == 0 {
        Ok(())
    } else {
        Err("io_failed")
    }
}
impl Config for FdConfig {
    fn exclusive(&mut self) -> Result<(), &'static str> {
        control(self.0, TIOCEXCL).map_err(|_| {
            if errno() == EBUSY {
                "busy"
            } else {
                "io_failed"
            }
        })
    }
    fn get(&mut self) -> Result<termios, &'static str> {
        let mut value = std::mem::MaybeUninit::uninit();
        // SAFETY: live fd and writable termios storage; only assume initialized after success.
        if unsafe { tcgetattr(self.0, value.as_mut_ptr()) } != 0 {
            return Err("io_failed");
        }
        // SAFETY: successful tcgetattr initialized value.
        Ok(unsafe { value.assume_init() })
    }
    fn set(&mut self, value: &termios) -> Result<(), &'static str> {
        // SAFETY: live fd and initialized termios, borrowed for this call only.
        if unsafe { tcsetattr(self.0, TCSANOW, value) } == 0 {
            Ok(())
        } else {
            Err("io_failed")
        }
    }
    fn dtr(&mut self) -> Result<(), &'static str> {
        control(self.0, TIOCSDTR)
    }
    fn modem(&mut self) -> Result<c_int, &'static str> {
        let mut bits = 0;
        // SAFETY: live fd and writable integer storage for this ioctl.
        if unsafe { ioctl(self.0, TIOCMGET, &mut bits) } == 0 {
            Ok(bits)
        } else {
            Err("io_failed")
        }
    }
}
fn poll_fd(fd: RawFd, events: c_short, timeout: c_int) -> Result<c_short, &'static str> {
    let mut descriptor = pollfd {
        fd,
        events,
        revents: 0,
    };
    // SAFETY: one initialized writable pollfd; bounded nonnegative timeout.
    if unsafe { poll(&mut descriptor, 1, timeout) } < 0 {
        if errno() == EINTR {
            return Ok(0);
        }
        return Err(io_code(errno()));
    }
    Ok(descriptor.revents)
}
fn terminal(flags: c_short) -> bool {
    flags & (POLLHUP | POLLERR | POLLNVAL) != 0
}
fn write_all(
    bytes: &[u8],
    mut remaining: impl FnMut() -> Option<c_int>,
    mut attempt: impl FnMut(&[u8], c_int) -> Result<usize, &'static str>,
) -> Result<(), &'static str> {
    let mut offset = 0;
    while offset < bytes.len() {
        let timeout = remaining().ok_or("io_failed")?;
        let n = attempt(&bytes[offset..], timeout)?;
        if n > bytes.len() - offset {
            return Err("io_failed");
        }
        offset += n;
    }
    Ok(())
}
fn read_ready(
    flags: c_short,
    hungup: &mut bool,
    mut read_once: impl FnMut() -> Result<Option<Vec<u8>>, &'static str>,
) -> Result<Option<Vec<u8>>, &'static str> {
    *hungup |= terminal(flags);
    if flags & POLLIN != 0 {
        match read_once() {
            Ok(Some(bytes)) => return Ok(Some(bytes)),
            Ok(None) => {}
            Err(code) => return Err(if *hungup { "disconnected" } else { code }),
        }
    }
    if *hungup {
        Err("disconnected")
    } else {
        Ok(None)
    }
}
fn close_steps(
    mut line: impl FnMut(c_int) -> Result<(), &'static str>,
    release: impl FnOnce() -> bool,
) -> Result<(), &'static str> {
    let dtr = line(TIOCCDTR);
    let exclusive = line(TIOCNXCL);
    let closed = release();
    if dtr.is_err() || exclusive.is_err() || !closed {
        Err("io_failed")
    } else {
        Ok(())
    }
}
struct Port {
    fd: Option<RawFd>,
    hungup: bool,
}
impl Port {
    fn abandon(&mut self) -> Result<(), &'static str> {
        if let Some(fd) = self.fd.take() {
            // SAFETY: take transfers the unique fd; never retry close because its number may be reused.
            if unsafe { close(fd) } != 0 {
                return Err("io_failed");
            }
        }
        Ok(())
    }
    fn close_with(&mut self, release: impl FnOnce(RawFd) -> bool) -> Result<(), &'static str> {
        let Some(fd) = self.fd.take() else {
            return Ok(());
        };
        close_steps(|request| control(fd, request), || release(fd))
    }
    fn receive(&mut self, timeout: c_int) -> Result<Option<Vec<u8>>, &'static str> {
        let fd = self.fd.ok_or("disconnected")?;
        let flags = poll_fd(fd, POLLIN, timeout)?;
        read_ready(flags, &mut self.hungup, || {
            let mut bytes = vec![0; 4096];
            // SAFETY: live fd and writable buffer of exactly its advertised length.
            let n = unsafe { read(fd, bytes.as_mut_ptr().cast(), bytes.len()) };
            if n > 0 {
                bytes.truncate(n as usize);
                return Ok(Some(bytes));
            }
            if n == 0 {
                return Err("disconnected");
            }
            match errno() {
                EAGAIN | EINTR => Ok(None),
                code => Err(io_code(code)),
            }
        })
    }
}
impl SerialDevice for Port {
    fn read(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        self.receive(50)
    }
    fn pending(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        self.receive(0)
    }
    fn write(&mut self, bytes: &[u8]) -> Result<(), &'static str> {
        if !(1..=4096).contains(&bytes.len()) {
            return Err("invalid_request");
        }
        let fd = self.fd.ok_or("disconnected")?;
        let start = Instant::now();
        write_all(
            bytes,
            || {
                Duration::from_millis(500)
                    .checked_sub(start.elapsed())
                    .filter(|d| !d.is_zero())
                    .map(|d| d.as_millis().max(1) as c_int)
            },
            |bytes, timeout| {
                let flags = poll_fd(fd, POLLOUT, timeout)?;
                if terminal(flags) {
                    return Err("disconnected");
                }
                if flags & POLLOUT == 0 {
                    return Ok(0);
                }
                // SAFETY: live nonblocking fd and readable slice of exactly its advertised length.
                let n = unsafe { write(fd, bytes.as_ptr().cast(), bytes.len()) };
                if n >= 0 {
                    return Ok(n as usize);
                }
                match errno() {
                    EAGAIN | EINTR => Ok(0),
                    code => Err(io_code(code)),
                }
            },
        )
    }
    fn close(&mut self) -> Result<(), &'static str> {
        self.close_with(|fd| {
            // SAFETY: close_with transfers the unique fd exactly once, even if a line ioctl failed.
            unsafe { close(fd) == 0 }
        })
    }
}
impl Drop for Port {
    fn drop(&mut self) {
        let _ = self.abandon();
    }
}

#[cfg(test)]
#[path = "serial_macos_tests.rs"]
mod tests;
