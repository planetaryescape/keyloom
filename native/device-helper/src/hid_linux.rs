use crate::{
    backend::{Backend, Device, Endpoint, raw_descriptor},
    linux_io::Fd,
    linux_sysfs::{self, Record},
};
use std::path::Path;
pub struct Linux;
fn endpoint(r: Record) -> Endpoint {
    Endpoint {
        key: r.key(),
        permission_denied: crate::linux_io::permission_denied(&r.node),
        vendor: r.vendor,
        product: r.product,
        serial: r.serial,
        descriptor: r.descriptor,
        interface_number: r.interface,
    }
}
impl Backend for Linux {
    fn list(&self) -> Result<Vec<Endpoint>, &'static str> {
        Ok(
            linux_sysfs::discover(Path::new("/sys/class/hidraw"), Path::new("/dev"), true)?
                .into_iter()
                .filter(|r| raw_descriptor(&r.descriptor))
                .map(endpoint)
                .collect(),
        )
    }
    fn open(&self, expected: &Endpoint) -> Result<Box<dyn Device>, &'static str> {
        if !self.list()?.contains(expected) {
            return Err("stale_device");
        }
        let (_, path) = expected.key.rsplit_once('|').ok_or("stale_device")?;
        let mut fd = Fd::open(Path::new(path))?;
        let checked = (|| {
            fd.same_node(Path::new(path))?;
            if self.list()?.contains(expected) {
                Ok(())
            } else {
                Err("stale_device")
            }
        })();
        if let Err(e) = checked {
            if fd.close().is_err() {
                std::process::exit(1);
            }
            return Err(e);
        }
        Ok(Box::new(Hid(fd)))
    }
}
struct Hid(Fd);
impl Device for Hid {
    fn write(&mut self, bytes: &[u8; 32]) -> Result<(), &'static str> {
        self.0.write(&linux_sysfs::output_report(bytes), true)
    }
    fn read(&mut self) -> Result<Option<[u8; 32]>, &'static str> {
        self.0
            .read(50, 33)?
            .map(|b| linux_sysfs::input_report(&b))
            .transpose()
    }
    fn pending(&mut self) -> Result<Option<[u8; 32]>, &'static str> {
        self.0
            .read(0, 33)?
            .map(|b| linux_sysfs::input_report(&b))
            .transpose()
    }
    fn close(&mut self) -> Result<(), &'static str> {
        self.0.close()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn syscall_write_has_a_zero_id_and_syscall_read_keeps_the_first_payload_byte() {
        let (mut master, mut slave) = (-1, -1);
        // SAFETY: writable fd outputs; anonymous PTY only, never a device discovered from sysfs.
        assert_eq!(
            unsafe {
                libc::openpty(
                    &mut master,
                    &mut slave,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null(),
                )
            },
            0
        );
        let mut master = Fd(Some(master));
        let mut hid = Hid(Fd(Some(slave)));
        let mut value = std::mem::MaybeUninit::uninit();
        assert_eq!(unsafe { libc::tcgetattr(slave, value.as_mut_ptr()) }, 0);
        let raw = crate::serial_termios::raw(unsafe { value.assume_init() }).unwrap();
        assert_eq!(unsafe { libc::tcsetattr(slave, libc::TCSANOW, &raw) }, 0);
        for fd in [master.raw().unwrap(), slave] {
            assert_eq!(
                unsafe { libc::fcntl(fd, libc::F_SETFL, libc::O_NONBLOCK) },
                0
            );
        }
        for payload in [[0; 32], [0x7b; 32]] {
            hid.write(&payload).unwrap();
            assert_eq!(
                master.read(50, 64).unwrap().unwrap(),
                linux_sysfs::output_report(&payload)
            );
            master.write(&payload, false).unwrap();
            assert_eq!(hid.read(), Ok(Some(payload)));
        }
        master.close().unwrap();
        assert_eq!(hid.read(), Err("disconnected"));
        hid.close().unwrap();
    }
}
