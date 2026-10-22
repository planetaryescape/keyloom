use super::*;
use std::{ffi::CStr, fs, os::unix::fs::PermissionsExt};
fn pty() -> (Fd, Port) {
    let (mut master, mut slave) = (-1, -1);
    // SAFETY: two writable fd slots; no name or initial configuration requested. Allocates only a PTY.
    assert_eq!(
        unsafe {
            openpty(
                &mut master,
                &mut slave,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
            )
        },
        0
    );
    for fd in [master, slave] {
        assert_eq!(unsafe { fcntl(fd, F_SETFL, O_NONBLOCK) }, 0);
        assert_eq!(unsafe { fcntl(fd, F_SETFD, FD_CLOEXEC) }, 0);
    }
    (
        Fd(Some(master)),
        Port {
            fd: Fd(Some(slave)),
            safe_baud: false,
            exclusive: false,
        },
    )
}
#[test]
fn pty_raw_configuration_arbitrary_rates_and_bounded_io() {
    let (mut master, mut port) = pty();
    let fd = port.fd.raw().unwrap();
    let mut inherited = get(fd).unwrap();
    inherited.c_cflag |= HUPCL | CRTSCTS;
    set(fd, &inherited).unwrap();
    set(fd, &raw(get(fd).unwrap()).unwrap()).unwrap();
    assert!(verified(&get(fd).unwrap()));
    for baud in [1200, 1201] {
        port.set_rate(baud).unwrap();
        assert_eq!(port.rate().unwrap(), (baud, baud));
    }
    set(fd, &raw(get(fd).unwrap()).unwrap()).unwrap();
    assert_eq!(port.rate().unwrap(), (115200, 115200));
    master.write(b"synthetic\n", false).unwrap();
    assert_eq!(port.read().unwrap().unwrap(), b"synthetic\n");
    SerialDevice::write(&mut port, b"reply").unwrap();
    assert_eq!(master.read(50, 32).unwrap().unwrap(), b"reply");
    assert_eq!(port.pending().unwrap(), None);
    // Linux PTYs do not implement modem bits: ENOTTY must remain a failure, never a successful DTR check.
    assert_eq!(dtr(fd, true), Err("io_failed"));
    assert_eq!(dtr(fd, false), Err("io_failed"));
    master.close().unwrap();
    assert_eq!(port.read(), Err("disconnected"));
    port.fd.close().unwrap();
}
#[test]
fn pty_exclusive_blocks_new_opens_and_can_be_cleared() {
    let (_master, mut port) = pty();
    let fd = port.fd.raw().unwrap();
    let mut name = [0i8; 256];
    assert_eq!(unsafe { ttyname_r(fd, name.as_mut_ptr(), name.len()) }, 0);
    let path = Path::new(unsafe { CStr::from_ptr(name.as_ptr()) }.to_str().unwrap());
    exclusive(fd).unwrap();
    if unsafe { geteuid() } != 0 {
        assert_eq!(Fd::open(path).err(), Some("busy"));
    }
    assert_eq!(unsafe { ioctl(fd, TIOCNXCL) }, 0);
    let mut second = Fd::open(path).unwrap();
    second.same_node(path).unwrap();
    second.close().unwrap();
    port.fd.close().unwrap();
}
#[test]
fn denied_synthetic_node_reports_actionable_permission() {
    let path = std::env::temp_dir().join(format!("keyloom-denied-{}", std::process::id()));
    fs::write(&path, []).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o0)).unwrap();
    if unsafe { geteuid() } != 0 {
        assert_eq!(Fd::open(&path).err(), Some("permission_denied"));
    }
    assert_eq!(
        crate::linux_io::permission_denied(&path),
        unsafe { geteuid() } != 0
    );
    fs::remove_file(path).unwrap();
}
