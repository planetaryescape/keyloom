//! One-shot restart: set and verify the requested baud before lowering DTR.
use super::*;

/// `_IOW('T', 2, speed_t)` from IOKit/serial/ioss.h; libc doesn't define it.
const IOSSIOSPEED: c_ulong = 0x8008_5402;

trait TouchIo {
    fn get(&mut self) -> Result<termios, &'static str>;
    fn set_speed(&mut self, baud: speed_t) -> Result<(), &'static str>;
    fn clear_dtr(&mut self) -> Result<(), c_int>;
    fn close(&mut self) -> Result<(), &'static str>;
}
fn sequence(
    io: &mut impl TouchIo,
    baud: speed_t,
    recheck: impl FnOnce() -> Result<(), &'static str>,
) -> Result<(), OpenError> {
    let configured = (|| {
        recheck()?;
        // macOS's tcsetattr refuses a non-standard rate such as the 1201 relay with EINVAL (D-440).
        io.set_speed(baud)?;
        let actual = io.get()?;
        // SAFETY: actual was initialized by a successful tcgetattr.
        if unsafe { cfgetispeed(&actual) } != baud || unsafe { cfgetospeed(&actual) } != baud {
            return Err("io_failed");
        }
        // ENXIO means the endpoint vanished; there is no remaining line to control (D-432).
        match io.clear_dtr() {
            Ok(()) | Err(ENXIO) => Ok(()),
            Err(_) => Err("io_failed"),
        }
    })();
    // Close exactly once even when configuration failed; never repeat a possibly effective touch.
    let closed = io.close();
    configured.and(closed).map_err(|code| OpenError {
        code,
        possible: true,
    })
}
struct TouchPort(Port);
impl TouchIo for TouchPort {
    fn get(&mut self) -> Result<termios, &'static str> {
        FdConfig(self.0.fd.unwrap()).get()
    }
    fn set_speed(&mut self, baud: speed_t) -> Result<(), &'static str> {
        // SAFETY: live fd and readable speed_t storage, the argument IOSSIOSPEED reads.
        if unsafe { ioctl(self.0.fd.unwrap(), IOSSIOSPEED, &baud) } == 0 {
            Ok(())
        } else {
            Err("io_failed")
        }
    }
    fn clear_dtr(&mut self) -> Result<(), c_int> {
        control(self.0.fd.unwrap(), TIOCCDTR).map_err(|_| errno())
    }
    fn close(&mut self) -> Result<(), &'static str> {
        // Reuse Port's unique fd transfer and unwind cleanup, without capture's extra line transitions.
        // Unconfirmed release exits while the endpoint lease is still held.
        if self.0.abandon().is_err() {
            std::process::exit(1);
        }
        Ok(())
    }
}
pub(super) fn touch(expected: &SerialEndpoint, baud: u64) -> Result<(), OpenError> {
    if !matches!(baud, 1200 | 1201) {
        return Err("invalid_request".into());
    }
    let (id, path) = expected.key.split_once(':').ok_or("stale_device")?;
    let id = id.parse().map_err(|_| "stale_device")?;
    let mut resolve = || resolve_endpoint(id);
    check_endpoint(expected, &mut resolve)?;
    let path = CString::new(path).map_err(|_| "stale_device")?;
    // SAFETY: NUL-terminated path remains live through open; success transfers a unique fd.
    let fd = unsafe { open(path.as_ptr(), O_RDWR | O_NOCTTY | O_NONBLOCK | O_CLOEXEC) };
    if fd < 0 {
        return Err(open_code(errno()).into());
    }
    sequence(
        &mut TouchPort(Port {
            fd: Some(fd),
            hungup: false,
        }),
        baud as speed_t,
        || check_endpoint(expected, &mut resolve),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fake {
        steps: Vec<&'static str>,
        fail: Option<&'static str>,
        speed: speed_t,
        line: Option<c_int>,
    }
    impl TouchIo for Fake {
        fn get(&mut self) -> Result<termios, &'static str> {
            self.steps.push("get");
            if self.fail == Some("get") {
                return Err("io_failed");
            }
            // SAFETY: a zero termios is valid storage for the pure speed setters/getters.
            let mut value: termios = unsafe { std::mem::zeroed() };
            unsafe {
                cfsetispeed(&mut value, self.speed);
                cfsetospeed(&mut value, self.speed);
            }
            Ok(value)
        }
        fn set_speed(&mut self, baud: speed_t) -> Result<(), &'static str> {
            self.steps.push("speed");
            if self.fail == Some("speed") {
                return Err("io_failed");
            }
            if self.fail != Some("verify") {
                self.speed = baud;
            }
            Ok(())
        }
        fn clear_dtr(&mut self) -> Result<(), c_int> {
            self.steps.push("dtr");
            self.line.map_or(Ok(()), Err)
        }
        fn close(&mut self) -> Result<(), &'static str> {
            self.steps.push("close");
            if self.fail == Some("close") {
                Err("io_failed")
            } else {
                Ok(())
            }
        }
    }
    fn fake(fail: Option<&'static str>) -> Fake {
        Fake {
            steps: vec![],
            fail,
            speed: B115200,
            line: None,
        }
    }
    #[test]
    fn baud_verified_before_dtr_and_one_close() {
        for baud in [1200, 1201] {
            let mut io = fake(None);
            assert_eq!(sequence(&mut io, baud, || Ok(())), Ok(()));
            assert_eq!(io.speed, baud);
            assert_eq!(io.steps, ["speed", "get", "dtr", "close"]);
        }
    }
    #[test]
    fn failures_after_open_are_possible_and_always_close_once() {
        for failure in ["speed", "get", "verify", "close"] {
            let mut io = fake(Some(failure));
            assert!(sequence(&mut io, 1200, || Ok(())).unwrap_err().possible);
            assert_eq!(io.steps.iter().filter(|s| **s == "close").count(), 1);
            if failure != "close" {
                assert!(!io.steps.contains(&"dtr"));
            }
        }
        let mut io = fake(None);
        assert_eq!(
            sequence(&mut io, 1201, || Err("stale_device")),
            Err(OpenError {
                code: "stale_device",
                possible: true
            })
        );
        assert_eq!(io.steps, ["close"]);
    }
    #[test]
    fn only_enxio_proves_the_line_vanished() {
        for code in [ENXIO, ENODEV, EIO] {
            let mut io = fake(None);
            io.line = Some(code);
            assert_eq!(sequence(&mut io, 1200, || Ok(())).is_ok(), code == ENXIO);
            assert_eq!(io.steps.last(), Some(&"close"));
        }
    }
}
