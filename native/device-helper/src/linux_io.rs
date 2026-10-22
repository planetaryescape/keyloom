//! Owned nonblocking descriptors. No readers or buffers outlive the session owner.
use libc::*;
use std::{
    ffi::CString,
    os::{
        fd::RawFd,
        unix::{
            ffi::OsStrExt,
            fs::{FileTypeExt, MetadataExt},
        },
    },
    path::Path,
    time::{Duration, Instant},
};
pub fn errno() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
}
pub fn open_code(n: i32) -> &'static str {
    match n {
        EACCES | EPERM => "permission_denied",
        EBUSY => "busy",
        ENOENT | ENODEV | ENXIO => "not_found",
        _ => "io_failed",
    }
}
pub fn io_code(n: i32) -> &'static str {
    if matches!(n, ENODEV | ENXIO | EIO | EPIPE) {
        "disconnected"
    } else {
        "io_failed"
    }
}
// ENODEV/ENXIO prove absence. EIO alone also describes other I/O failures and cannot confirm close.
pub fn vanished(n: i32) -> bool {
    matches!(n, ENODEV | ENXIO)
}
pub fn permission_denied(path: &Path) -> bool {
    let Ok(path) = CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: read-only credential check, not an operational device open. Open remains authoritative.
    unsafe { access(path.as_ptr(), R_OK | W_OK) != 0 && matches!(errno(), EACCES | EPERM) }
}
pub struct Fd(pub Option<RawFd>);
impl Fd {
    pub fn open(path: &Path) -> Result<Self, &'static str> {
        let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| "stale_device")?;
        // SAFETY: live NUL-terminated path; success transfers one descriptor into Fd.
        let fd = unsafe { open(path.as_ptr(), O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC) };
        if fd < 0 {
            Err(open_code(errno()))
        } else {
            Ok(Self(Some(fd)))
        }
    }
    pub fn raw(&self) -> Result<RawFd, &'static str> {
        self.0.ok_or("disconnected")
    }
    pub fn same_node(&self, path: &Path) -> Result<(), &'static str> {
        let meta = std::fs::metadata(path).map_err(|_| "stale_device")?;
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: live fd and writable stat storage, read only after success.
        if unsafe { fstat(self.raw()?, stat.as_mut_ptr()) } != 0 {
            return Err("stale_device");
        }
        let stat = unsafe { stat.assume_init() };
        if meta.file_type().is_char_device()
            && meta.rdev() == stat.st_rdev
            && meta.ino() == stat.st_ino
            && meta.dev() == stat.st_dev
        {
            Ok(())
        } else {
            Err("stale_device")
        }
    }
    pub fn poll(&self, events: c_short, timeout: c_int) -> Result<c_short, &'static str> {
        let mut p = pollfd {
            fd: self.raw()?,
            events,
            revents: 0,
        };
        // SAFETY: initialized single pollfd; timeout bounded by caller.
        if unsafe { poll(&mut p, 1, timeout) } < 0 {
            return if errno() == EINTR {
                Ok(0)
            } else {
                Err(io_code(errno()))
            };
        }
        if p.revents & (POLLHUP | POLLERR) != 0 {
            return Err("disconnected");
        }
        if p.revents & POLLNVAL != 0 {
            return Err("io_failed");
        }
        Ok(p.revents)
    }
    pub fn read(&self, timeout: c_int, limit: usize) -> Result<Option<Vec<u8>>, &'static str> {
        if self.poll(POLLIN, timeout)? & POLLIN == 0 {
            return Ok(None);
        }
        let mut bytes = vec![0; limit];
        // SAFETY: owned fd and writable buffer of advertised size.
        let n = unsafe { read(self.raw()?, bytes.as_mut_ptr().cast(), bytes.len()) };
        if n > 0 {
            bytes.truncate(n as usize);
            Ok(Some(bytes))
        } else if n == 0 || matches!(errno(), EAGAIN | EINTR) {
            // VMIN=0 permits an empty tty read; only poll/removal errors prove disconnect.
            Ok(None)
        } else {
            Err(io_code(errno()))
        }
    }
    pub fn write(&self, bytes: &[u8], report: bool) -> Result<(), &'static str> {
        let start = Instant::now();
        let mut offset = 0;
        while offset < bytes.len() {
            let left = Duration::from_millis(500)
                .checked_sub(start.elapsed())
                .filter(|d| !d.is_zero())
                .ok_or("io_failed")?;
            if self.poll(POLLOUT, left.as_millis().max(1) as c_int)? & POLLOUT == 0 {
                continue;
            }
            // SAFETY: live fd and readable remaining slice.
            let n = unsafe {
                write(
                    self.raw()?,
                    bytes[offset..].as_ptr().cast(),
                    bytes.len() - offset,
                )
            };
            if n < 0 {
                if matches!(errno(), EAGAIN | EINTR) {
                    continue;
                }
                return Err(io_code(errno()));
            }
            // A short HID write is one failed report, never a second report containing the tail.
            if report && n as usize != bytes.len() {
                return Err("io_failed");
            }
            offset += n as usize;
        }
        Ok(())
    }
    pub fn close(&mut self) -> Result<(), &'static str> {
        let Some(fd) = self.0.take() else {
            return Ok(());
        };
        // SAFETY: unique fd is consumed once. Linux releases it even on EINTR; never retry a reused number.
        if unsafe { close(fd) } == 0 {
            Ok(())
        } else {
            Err("io_failed")
        }
    }
}
impl Drop for Fd {
    fn drop(&mut self) {
        let _ = self.close();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_proven_removal_allows_missing_line_cleanup() {
        assert!(vanished(ENODEV));
        assert!(vanished(ENXIO));
        for e in [EIO, ENOTTY, EINTR, EBADF] {
            assert!(!vanished(e));
        }
    }
    #[test]
    fn access_errors_and_removal_are_distinct() {
        assert_eq!(open_code(EACCES), "permission_denied");
        assert_eq!(open_code(EBUSY), "busy");
        assert_eq!(io_code(EIO), "disconnected");
    }
}
