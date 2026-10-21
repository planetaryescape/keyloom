use super::*;
use std::collections::VecDeque;
fn blank() -> termios {
    // SAFETY: termios consists of integer fields; zero is a valid initial value for the pure builder.
    unsafe { std::mem::zeroed() }
}
fn record(id: u64, path: &str, serial: &str) -> Record {
    Record {
        id,
        path: Some(path.into()),
        parents: vec![
            Properties {
                interface: Some(3),
                ..Properties::default()
            },
            Properties {
                vendor: Some(0x16c0),
                product: Some(0x27db),
                serial: Some(serial.into()),
                product_name: Some("Synthetic USB".into()),
                ..Properties::default()
            },
        ],
    }
}
#[test]
fn synthetic_registry_records_keep_attachment_identity_and_sort_order() {
    let a = endpoint(record(20, "/dev/cu.synthetic", "same")).unwrap();
    let b = endpoint(record(21, "/dev/cu.synthetic", "same")).unwrap();
    assert_ne!(a.key, b.key);
    assert_eq!(a.interface_number, Some(3));
    assert_eq!(a.product_name.as_deref(), Some("Synthetic USB"));
    assert_eq!(a.serial.as_deref(), Some("same"));
    assert_eq!(sorted(vec![a.clone(), b.clone()]), sorted(vec![b, a]));
    assert_eq!(
        endpoint(record(1, "/dev/cu.empty", "")).unwrap().serial,
        None
    );
    let mut missing = record(1, "/dev/cu.nonusb", "s");
    missing.parents[1].product = None;
    assert!(endpoint(missing).is_none());
    let mut missing = record(1, "/dev/cu.none", "s");
    missing.path = None;
    assert!(endpoint(missing).is_none());
    assert!(endpoint(record(1, "/dev/tty.synthetic", "s")).is_none());
    let a = endpoint(record(1, "/dev/cu.synthetic", "s")).unwrap();
    assert_eq!(sorted(vec![a; 257]), Err("capacity"));
}
#[test]
fn identity_metadata_comes_from_the_owning_usb_device_not_a_hub_above_it() {
    let mut hub = record(30, "/dev/cu.synthetic", "");
    hub.parents[1].product_name = None;
    hub.parents.push(Properties {
        vendor: Some(0x05e3),
        product: Some(0x0610),
        serial: Some("hub-serial".into()),
        product_name: Some("Synthetic Hub".into()),
        interface: Some(9),
    });
    let endpoint = endpoint(hub).unwrap();
    assert_eq!((endpoint.vendor, endpoint.product), (0x16c0, 0x27db));
    assert_eq!(endpoint.serial, None);
    assert_eq!(endpoint.product_name, None);
    assert_eq!(endpoint.interface_number, Some(3));
}
#[test]
fn readback_rejects_each_configuration_mismatch() {
    let value = raw(blank()).unwrap();
    assert!(
        verified(&value),
        "speed {}/{} flags if={:x} of={:x} cf={:x} lf={:x} mask={:x} expected={:x} cc={}/{}",
        value.c_ispeed,
        value.c_ospeed,
        value.c_iflag,
        value.c_oflag,
        value.c_cflag,
        value.c_lflag,
        CSIZE | PARENB | PARODD | CSTOPB | CRTSCTS | HUPCL | CLOCAL | CREAD,
        CS8 | CLOCAL | CREAD,
        value.c_cc[VMIN],
        value.c_cc[VTIME]
    );
    for bit in [
        HUPCL,
        PARENB,
        PARODD,
        CSTOPB,
        CRTSCTS,
        0x0004_0000,
        0x0008_0000,
        0x0010_0000,
    ] {
        let mut changed = value;
        changed.c_cflag |= bit;
        assert!(!verified(&changed), "c_cflag {bit}");
    }
    for bit in [CLOCAL, CREAD] {
        let mut changed = value;
        changed.c_cflag &= !bit;
        assert!(!verified(&changed));
    }
    for bit in [IXON, IXOFF, IXANY, ICRNL] {
        let mut changed = value;
        changed.c_iflag |= bit;
        assert!(!verified(&changed));
    }
    let mut changed = value;
    changed.c_cflag = (changed.c_cflag & !CSIZE) | CS7;
    assert!(!verified(&changed));
    changed = value;
    changed.c_ispeed = B1200;
    assert!(!verified(&changed));
    changed = value;
    changed.c_ospeed = B1200;
    assert!(!verified(&changed));
    changed = value;
    changed.c_lflag |= ICANON;
    assert!(!verified(&changed));
    changed = value;
    changed.c_oflag |= OPOST;
    assert!(!verified(&changed));
}
struct Script {
    calls: Vec<&'static str>,
    get: VecDeque<Result<termios, &'static str>>,
    fail: Option<&'static str>,
    bits: c_int,
}
impl Script {
    fn new() -> Self {
        Self {
            calls: vec![],
            get: VecDeque::from([Ok(blank()), Ok(raw(blank()).unwrap())]),
            fail: None,
            bits: TIOCM_DTR,
        }
    }
    fn call(&mut self, name: &'static str) -> Result<(), &'static str> {
        self.calls.push(name);
        if self.fail == Some(name) {
            Err("io_failed")
        } else {
            Ok(())
        }
    }
}
impl Config for Script {
    fn exclusive(&mut self) -> Result<(), &'static str> {
        self.call("exclusive")
    }
    fn get(&mut self) -> Result<termios, &'static str> {
        self.call("get")?;
        self.get.pop_front().unwrap()
    }
    fn set(&mut self, value: &termios) -> Result<(), &'static str> {
        assert!(verified(value));
        self.call("set")
    }
    fn dtr(&mut self) -> Result<(), &'static str> {
        self.call("dtr")
    }
    fn modem(&mut self) -> Result<c_int, &'static str> {
        self.call("modem")?;
        Ok(self.bits)
    }
}
#[test]
fn configuration_checks_order_and_failure_after_dtr_assertion() {
    let mut io = Script::new();
    let mut safe = false;
    assert_eq!(configure(&mut io, &mut safe), Ok(()));
    assert!(safe);
    assert_eq!(io.calls, ["exclusive", "get", "set", "get", "dtr", "modem"]);
    let mut io = Script::new();
    io.fail = Some("modem");
    assert_eq!(configure(&mut io, &mut safe), Err("io_failed"));
    assert!(
        safe,
        "cleanup may clear DTR only after confirmed capture baud"
    );
    assert_eq!(io.calls.last(), Some(&"modem"));
    for failure in ["exclusive", "get", "set", "dtr"] {
        let mut io = Script::new();
        io.fail = Some(failure);
        safe = false;
        assert_eq!(configure(&mut io, &mut safe), Err("io_failed"));
        assert_eq!(safe, failure == "dtr");
        assert_eq!(io.calls.last(), Some(&failure));
    }
    let mut io = Script::new();
    io.get[1] = Ok(blank());
    safe = false;
    assert_eq!(configure(&mut io, &mut safe), Err("io_failed"));
    assert!(!safe);
    assert!(!io.calls.contains(&"dtr"));
    let mut io = Script::new();
    io.bits = 0;
    safe = false;
    assert_eq!(configure(&mut io, &mut safe), Err("io_failed"));
    assert!(safe);
}
#[test]
fn hangup_delivers_readable_data_before_sticky_disconnect() {
    let mut hungup = false;
    assert_eq!(
        read_ready(POLLIN | POLLHUP, &mut hungup, || Ok(Some(vec![1; 4096]))),
        Ok(Some(vec![1; 4096]))
    );
    assert_eq!(
        read_ready(POLLIN | POLLHUP, &mut hungup, || Ok(Some(vec![2]))),
        Ok(Some(vec![2]))
    );
    assert_eq!(
        read_ready(0, &mut hungup, || panic!("must not read")),
        Err("disconnected")
    );
    assert_eq!(
        read_ready(POLLIN | POLLNVAL, &mut false, || Err("io_failed")),
        Err("disconnected")
    );
    for flag in [POLLERR, POLLNVAL] {
        assert_eq!(
            read_ready(flag, &mut false, || panic!("must not read")),
            Err("disconnected")
        );
    }
}
#[test]
fn partial_write_deadline_is_failure_and_not_replayed() {
    let mut times = VecDeque::from([Some(500), None]);
    let mut calls = 0;
    assert_eq!(
        write_all(
            &[1; 32],
            || times.pop_front().unwrap(),
            |bytes, _| {
                calls += 1;
                assert_eq!(bytes.len(), 32);
                Ok(4)
            }
        ),
        Err("io_failed")
    );
    assert_eq!(calls, 1);
    let mut lengths = vec![];
    assert_eq!(
        write_all(
            &[1; 9],
            || Some(1),
            |bytes, _| {
                lengths.push(bytes.len());
                Ok(bytes.len().min(4))
            }
        ),
        Ok(())
    );
    assert_eq!(lengths, [9, 5, 1]);
}
#[test]
fn errors_map_without_native_access() {
    for code in [EACCES, EPERM] {
        assert_eq!(open_code(code), "permission_denied");
    }
    assert_eq!(open_code(EBUSY), "busy");
    for code in [ENOENT, ENXIO, ENODEV] {
        assert_eq!(open_code(code), "not_found");
    }
    assert_eq!(open_code(EINVAL), "io_failed");
    for code in [EPIPE, EIO, ENXIO, ENODEV] {
        assert_eq!(io_code(code), "disconnected");
    }
}
fn pty() -> (Port, Port) {
    let (mut master, mut slave) = (-1, -1);
    // SAFETY: outputs are writable; null name/termios/winsize request a fresh anonymous pseudo-terminal.
    assert_eq!(
        unsafe {
            openpty(
                &mut master,
                &mut slave,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        },
        0
    );
    for fd in [master, slave] {
        // SAFETY: both fds are freshly owned; fcntl sets nonblocking mode, required by bounded I/O.
        assert_eq!(unsafe { fcntl(fd, F_SETFL, O_NONBLOCK) }, 0);
    }
    (
        Port {
            fd: Some(master),
            hungup: false,
        },
        Port {
            fd: Some(slave),
            hungup: false,
        },
    )
}
#[test]
fn pty_raw_baud_roundtrip_chunks_and_bounded_reads() {
    let (mut master, mut slave) = pty();
    let mut io = FdConfig(slave.fd.unwrap());
    let raw = raw(io.get().unwrap()).unwrap();
    io.set(&raw).unwrap();
    assert!(verified(&io.get().unwrap()));
    assert_eq!(slave.pending(), Ok(None));
    let start = Instant::now();
    assert_eq!(slave.read(), Ok(None));
    assert!(start.elapsed() < Duration::from_millis(250));
    let bytes: Vec<u8> = (0..512).map(|n| n as u8).collect();
    master.write(&bytes).unwrap();
    master.write(b"tail").unwrap();
    let mut received = slave.read().unwrap().unwrap();
    while let Some(chunk) = slave.pending().unwrap() {
        received.extend(chunk);
    }
    assert_eq!(received, [bytes.as_slice(), b"tail"].concat());
    slave.write(b"response").unwrap();
    assert_eq!(master.read().unwrap().unwrap(), b"response");
}
#[test]
fn pty_modem_failure_is_reported_and_close_still_releases_fd() {
    let (_master, mut slave) = pty();
    let fd = slave.fd.unwrap();
    // A pty supplies no USB modem signals. This checks error handling, never physical DTR.
    assert_eq!(FdConfig(fd).modem(), Err("io_failed"));
    assert_eq!(control(fd, TIOCCDTR), Err("io_failed"));
    let mut closed = vec![];
    assert_eq!(
        slave.close_with(|owned| {
            // SAFETY: close_with transfers its unique PTY fd once; the observer closes it without retry.
            let success = unsafe { close(owned) == 0 };
            closed.push((owned, success));
            success
        }),
        Err("io_failed")
    );
    assert!(slave.fd.is_none());
    assert_eq!(closed, [(fd, true)]);
    assert_eq!(slave.close_with(|_| panic!("must not close twice")), Ok(()));
}

#[test]
fn failed_open_cleanup_carries_possible_effect_after_dtr_or_unsafe_readback() {
    for mismatch in [false, true] {
        let mut io = Script::new();
        if mismatch {
            io.get[1] = Ok(blank());
        } else {
            io.fail = Some("modem");
        }
        let mut cleanup = vec![];
        assert_eq!(
            initialize(&mut io, || Ok(()), |safe| cleanup.push(safe)),
            Err(OpenError {
                code: "io_failed",
                possible: true
            })
        );
        assert_eq!(cleanup, [!mismatch]);
        assert_eq!(io.calls.contains(&"dtr"), !mismatch);
    }
}
#[test]
fn pty_partial_write_hits_total_deadline_with_no_reader() {
    let (mut master, mut slave) = pty();
    let mut io = FdConfig(slave.fd.unwrap());
    let value = raw(io.get().unwrap()).unwrap();
    io.set(&value).unwrap();
    let start = Instant::now();
    assert_eq!(master.write(&[0x80; 4096]), Err("io_failed"));
    assert!(start.elapsed() >= Duration::from_millis(490));
    assert!(start.elapsed() < Duration::from_millis(1000));
    let mut total = 0;
    while let Some(chunk) = slave.pending().unwrap() {
        total += chunk.len();
    }
    assert!(total > 0 && total < 4096, "partial effect: {total}");
}

#[test]
fn close_attempts_dtr_exclusion_and_fd_release_even_after_failure() {
    for failure in [None, Some(TIOCCDTR), Some(TIOCNXCL), Some(-1)] {
        let calls = std::cell::RefCell::new(vec![]);
        let result = close_steps(
            |request| {
                calls.borrow_mut().push(request);
                if failure == Some(request) {
                    Err("io_failed")
                } else {
                    Ok(())
                }
            },
            || {
                calls.borrow_mut().push(-1);
                failure != Some(-1)
            },
        );
        assert_eq!(
            result,
            if failure.is_none() {
                Ok(())
            } else {
                Err("io_failed")
            }
        );
        assert_eq!(*calls.borrow(), [TIOCCDTR, TIOCNXCL, -1]);
    }
}

#[test]
fn post_open_identity_change_closes_without_configuration() {
    let expected = endpoint(record(20, "/dev/cu.synthetic", "same")).unwrap();
    let replacement = endpoint(record(21, "/dev/cu.synthetic", "same")).unwrap();
    let mut metadata_changed = expected.clone();
    metadata_changed.product += 1;
    for after_open in [None, Some(replacement), Some(metadata_changed)] {
        let mut snapshots = VecDeque::from([Ok(Some(expected.clone())), Ok(after_open)]);
        let mut resolve = || snapshots.pop_front().unwrap();
        assert_eq!(check_endpoint(&expected, &mut resolve), Ok(()));
        let (_master, mut opened) = pty();
        let mut io = Script::new();
        let mut cleanup = vec![];
        let result = initialize(
            &mut io,
            || check_endpoint(&expected, &mut resolve),
            |safe| {
                cleanup.push(safe);
                assert_eq!(opened.abandon(), Ok(()));
            },
        );
        assert_eq!(
            result,
            Err(OpenError {
                code: "stale_device",
                possible: true
            })
        );
        assert!(
            io.calls.is_empty(),
            "must recheck before any configuration ioctl"
        );
        assert_eq!(cleanup, [false]);
        assert!(opened.fd.is_none());
        assert!(
            snapshots.is_empty(),
            "both pre-open and post-open checks must resolve identity"
        );
    }
}
