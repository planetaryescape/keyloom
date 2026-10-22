//! Injected ordering is portable; Linux termios2 and modem ioctls live in serial_linux.
#[derive(Debug, PartialEq)]
pub struct Failure {
    pub code: &'static str,
}
pub trait TouchIo {
    fn exclusive(&mut self) -> Result<(), &'static str>;
    fn set_rate(&mut self, baud: u32) -> Result<(), &'static str>;
    fn rate(&mut self) -> Result<(u32, u32), &'static str>;
    fn clear_dtr(&mut self) -> Result<(), &'static str>;
    fn close(&mut self) -> Result<(), &'static str>;
}
pub fn sequence(
    io: &mut impl TouchIo,
    baud: u32,
    recheck: impl FnOnce() -> Result<(), &'static str>,
) -> Result<(), Failure> {
    let configured = (|| {
        recheck()?;
        io.exclusive()?;
        io.set_rate(baud)?;
        if io.rate()? != (baud, baud) {
            return Err("io_failed");
        }
        io.clear_dtr()
    })();
    let closed = io.close();
    configured.and(closed).map_err(|code| Failure { code })
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Fake {
        steps: Vec<&'static str>,
        fail: Option<&'static str>,
        baud: u32,
    }
    impl Fake {
        fn step(&mut self, s: &'static str) -> Result<(), &'static str> {
            self.steps.push(s);
            if self.fail == Some(s) {
                Err("io_failed")
            } else {
                Ok(())
            }
        }
    }
    impl TouchIo for Fake {
        fn exclusive(&mut self) -> Result<(), &'static str> {
            self.step("exclusive")
        }
        fn set_rate(&mut self, b: u32) -> Result<(), &'static str> {
            self.step("set")?;
            self.baud = b;
            Ok(())
        }
        fn rate(&mut self) -> Result<(u32, u32), &'static str> {
            self.step("verify")?;
            Ok((
                self.baud,
                if self.fail == Some("mismatch") {
                    115200
                } else {
                    self.baud
                },
            ))
        }
        fn clear_dtr(&mut self) -> Result<(), &'static str> {
            self.step("dtr")
        }
        fn close(&mut self) -> Result<(), &'static str> {
            self.step("close")
        }
    }
    #[test]
    fn rates_verified_before_dtr_and_one_close_on_every_failure() {
        for baud in [1200, 1201] {
            for fail in [
                None,
                Some("exclusive"),
                Some("set"),
                Some("verify"),
                Some("mismatch"),
                Some("dtr"),
                Some("close"),
            ] {
                let mut io = Fake {
                    steps: vec![],
                    fail,
                    baud: 115200,
                };
                assert_eq!(sequence(&mut io, baud, || Ok(())).is_ok(), fail.is_none());
                assert_eq!(io.steps.iter().filter(|s| **s == "close").count(), 1);
                if fail == Some("mismatch") {
                    assert!(!io.steps.contains(&"dtr"));
                }
                if fail.is_none() {
                    assert_eq!(io.steps, ["exclusive", "set", "verify", "dtr", "close"]);
                    assert_eq!(io.baud, baud);
                }
            }
            let mut io = Fake {
                steps: vec![],
                fail: None,
                baud: 115200,
            };
            assert_eq!(
                sequence(&mut io, baud, || Err("stale_device")),
                Err(Failure {
                    code: "stale_device"
                })
            );
            assert_eq!(io.steps, ["close"]);
        }
    }
}
