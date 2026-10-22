//! Portable policy shared by the Windows adapters and injected tests. No OS/device calls here.
#[derive(Clone, Debug, PartialEq)]
pub struct Identity {
    pub instance: String,
    pub vendor: u16,
    pub product: u16,
    pub serial: Option<String>,
    pub interface: Option<u8>,
}
pub trait Tree {
    fn instance(&self, node: u32) -> Result<String, &'static str>;
    fn unique_id(&self, node: u32) -> bool;
    fn parent(&self, node: u32) -> Result<u32, &'static str>;
}
fn hex_field(id: &str, field: &str, digits: usize) -> Option<u16> {
    let offset = id.find(field)? + field.len();
    u16::from_str_radix(id.get(offset..offset + digits)?, 16).ok()
}
pub fn usb_owner(tree: &impl Tree, mut node: u32) -> Result<Identity, &'static str> {
    let mut interface = None;
    let mut seen = std::collections::HashSet::new();
    for _ in 0..32 {
        if !seen.insert(node) {
            break;
        }
        let instance = tree.instance(node)?;
        let upper = instance.to_ascii_uppercase();
        let device = upper.split('\\').nth(1).ok_or("unsupported")?;
        if interface.is_none() {
            interface = hex_field(device, "&MI_", 2).map(|v| v as u8);
        }
        if upper.starts_with("USB\\") && !device.contains("&MI_") {
            // Stop at the first USB device even when it has no serial. Never borrow a hub's.
            let vendor = hex_field(device, "VID_", 4).ok_or("unsupported")?;
            let product = hex_field(device, "PID_", 4).ok_or("unsupported")?;
            let serial = if tree.unique_id(node) {
                instance
                    .split('\\')
                    .nth(2)
                    .filter(|s| !s.is_empty())
                    .map(|s| {
                        // Windows IDs are case-insensitive. Restore only our known marker prefix;
                        // the build key and half are uppercase already. Keep foreign serials intact.
                        if s.get(..8)
                            .is_some_and(|p| p.eq_ignore_ascii_case("keyloom/"))
                        {
                            format!("keyloom/{}", &s[8..])
                        } else {
                            s.to_owned()
                        }
                    })
            } else {
                None
            };
            return Ok(Identity {
                instance,
                vendor,
                product,
                serial,
                interface,
            });
        }
        node = tree.parent(node)?;
    }
    Err("unsupported")
}
pub fn endpoint_key(instance: &str, path: &str) -> String {
    format!("{instance}|{path}")
}

pub fn com_path(name: &str) -> Result<String, &'static str> {
    let number = name.strip_prefix("COM").ok_or("unsupported")?;
    if number.is_empty()
        || number.starts_with('0')
        || !number.bytes().all(|c| c.is_ascii_digit())
        || number.parse::<u32>().is_err()
    {
        return Err("unsupported");
    }
    Ok(format!("\\\\.\\{name}"))
}
pub fn raw_caps(page: u16, usage: u16, input: u16, output: u16, feature: u16) -> bool {
    page == 0xff60 && usage == 0x61 && input == 33 && output == 33 && feature == 0
}
pub fn input_report(bytes: &[u8]) -> Result<[u8; 32], &'static str> {
    if bytes.len() != 33 || bytes[0] != 0 {
        return Err("io_failed");
    }
    bytes[1..].try_into().map_err(|_| "io_failed")
}
// CancelIoEx success is only an acknowledgement; only the completion status releases storage.
#[derive(Debug, PartialEq)]
pub enum Completion {
    Done(usize),
    Pending,
    Aborted,
    Failed(&'static str),
}
pub trait PendingIo {
    fn wait(&mut self, ms: u32) -> Result<(), &'static str>;
    fn result(&mut self) -> Completion;
    fn cancel(&mut self);
    fn unconfirmed(&mut self) -> !;
}
pub fn complete(
    io: &mut impl PendingIo,
    ms: u32,
    cancel_ms: u32,
) -> Result<Option<usize>, &'static str> {
    let waited = io.wait(ms);
    match io.result() {
        Completion::Done(n) => return Ok(Some(n)),
        Completion::Aborted => return Err("io_failed"),
        Completion::Failed(e) => return Err(e),
        Completion::Pending => (),
    }
    io.cancel();
    let _ = io.wait(cancel_ms);
    match io.result() {
        Completion::Done(n) => Ok(Some(n)), // Completion won the cancellation race: preserve bytes.
        Completion::Aborted => waited.map(|()| None),
        Completion::Failed(e) => Err(e),
        Completion::Pending => io.unconfirmed(),
    }
}
pub trait TouchIo {
    fn set_rate(&mut self, baud: u32) -> Result<(), &'static str>;
    fn rate(&mut self) -> Result<u32, &'static str>;
    fn clear_dtr(&mut self) -> Result<(), &'static str>;
    fn close(&mut self) -> Result<(), &'static str>;
    fn unconfirmed(&mut self) -> !;
}
pub fn touch(
    io: &mut impl TouchIo,
    baud: u32,
    recheck: impl FnOnce() -> Result<(), &'static str>,
) -> Result<(), &'static str> {
    let configured = (|| {
        recheck()?;
        io.set_rate(baud)?;
        if io.rate()? != baud {
            return Err("io_failed");
        }
        io.clear_dtr()
    })();
    let closed = io.close();
    if closed.is_err() {
        io.unconfirmed();
    }
    configured.and(closed)
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Nodes(Vec<(&'static str, bool)>);
    impl Tree for Nodes {
        fn instance(&self, n: u32) -> Result<String, &'static str> {
            Ok(self.0[n as usize].0.into())
        }
        fn unique_id(&self, n: u32) -> bool {
            self.0[n as usize].1
        }
        fn parent(&self, n: u32) -> Result<u32, &'static str> {
            if (n as usize) + 1 < self.0.len() {
                Ok(n + 1)
            } else {
                Err("unsupported")
            }
        }
    }
    #[test]
    fn owner_skips_interfaces_and_never_borrows_hub_serial() {
        let mut tree = Nodes(vec![
            ("HID\\VID_3297&PID_1969&MI_02&COL03\\generated", false),
            ("USB\\VID_3297&PID_1969&MI_02\\generated", false),
            ("USB\\VID_3297&PID_1969\\KEYLOOM/NPQRSTVWXYZ0", true),
            ("USB\\VID_1111&PID_2222\\hub", true),
        ]);
        let id = usb_owner(&tree, 0).unwrap();
        assert_eq!(
            (id.vendor, id.product, id.interface),
            (0x3297, 0x1969, Some(2))
        );
        assert_eq!(id.serial.as_deref(), Some("keyloom/NPQRSTVWXYZ0"));
        tree.0[2].1 = false;
        assert_eq!(usb_owner(&tree, 0).unwrap().serial, None);
        tree.0[2].0 = "USB\\VID_16C0&PID_27DB\\keyloom/NPQRSTVWXYZ0-L:GLV80-TEST";
        tree.0[2].1 = true;
        assert!(
            usb_owner(&tree, 0)
                .unwrap()
                .serial
                .unwrap()
                .ends_with("-L:GLV80-TEST")
        );
    }
    #[test]
    fn caps_and_report_ids_refuse_keyboard_numbered_and_short_reports() {
        assert!(raw_caps(0xff60, 0x61, 33, 33, 0));
        for v in [
            (1, 6, 33, 33, 0),
            (0xff60, 0x61, 32, 33, 0),
            (0xff60, 0x61, 33, 34, 0),
            (0xff60, 0x61, 33, 33, 33),
        ] {
            assert!(!raw_caps(v.0, v.1, v.2, v.3, v.4));
        }
        let mut b = [0; 33];
        b[1] = 0xe8;
        assert_eq!(input_report(&b).unwrap()[0], 0xe8);
        b[0] = 1;
        assert_eq!(input_report(&b), Err("io_failed"));
        assert!(input_report(&b[..32]).is_err());
    }
    #[test]
    fn com_numbers_are_ephemeral_and_paths_never_accept_arbitrary_input() {
        assert_eq!(com_path("COM123").unwrap(), "\\\\.\\COM123");
        for name in ["COM0", "COM01", "COM", "COM-1", "COM1\\x", "\\\\.\\COM12"] {
            assert!(com_path(name).is_err());
        }
    }
    #[test]
    fn renumbering_and_duplicate_serials_cannot_reuse_an_endpoint_key() {
        let a = "USB\\VID_16C0&PID_27DB\\same";
        let b = "USB\\VID_16C0&PID_27DB&MI_01\\same";
        assert_ne!(
            endpoint_key(a, &com_path("COM9").unwrap()),
            endpoint_key(a, &com_path("COM10").unwrap())
        );
        assert_ne!(
            endpoint_key(a, &com_path("COM10").unwrap()),
            endpoint_key(b, &com_path("COM10").unwrap())
        );
        struct Cycle;
        impl Tree for Cycle {
            fn instance(&self, _: u32) -> Result<String, &'static str> {
                Ok("HID\\VID_3297&PID_1969\\generated".into())
            }
            fn unique_id(&self, _: u32) -> bool {
                true
            }
            fn parent(&self, _: u32) -> Result<u32, &'static str> {
                Ok(0)
            }
        }
        assert_eq!(usb_owner(&Cycle, 0), Err("unsupported"));
        let tree = Nodes(vec![
            ("USB\\malformed\\no-ids", false),
            ("USB\\VID_1111&PID_2222\\hub", true),
        ]);
        assert_eq!(usb_owner(&tree, 0), Err("unsupported"));
    }
    struct Op {
        results: std::collections::VecDeque<Completion>,
        waits: Vec<u32>,
        cancelled: bool,
    }
    impl PendingIo for Op {
        fn wait(&mut self, ms: u32) -> Result<(), &'static str> {
            self.waits.push(ms);
            Ok(())
        }
        fn result(&mut self) -> Completion {
            self.results.pop_front().unwrap()
        }
        fn cancel(&mut self) {
            self.cancelled = true;
        }
        fn unconfirmed(&mut self) -> ! {
            panic!("storage still owned by kernel")
        }
    }
    #[test]
    fn cancellation_races_preserve_completion_and_unconfirmed_io_never_returns() {
        for (results, expected, cancel) in [
            (vec![Completion::Done(33)], Ok(Some(33)), false),
            (
                vec![Completion::Pending, Completion::Done(33)],
                Ok(Some(33)),
                true,
            ),
            (
                vec![Completion::Pending, Completion::Aborted],
                Ok(None),
                true,
            ),
            (
                vec![Completion::Failed("disconnected")],
                Err("disconnected"),
                false,
            ),
        ] {
            let mut op = Op {
                results: results.into(),
                waits: vec![],
                cancelled: false,
            };
            assert_eq!(complete(&mut op, 50, 500), expected);
            assert_eq!(op.cancelled, cancel);
            assert_eq!(op.waits[0], 50);
        }
        let mut write = Op {
            results: vec![Completion::Pending, Completion::Aborted].into(),
            waits: vec![],
            cancelled: false,
        };
        assert_eq!(complete(&mut write, 500, 0), Ok(None));
        assert_eq!(write.waits, [500, 0]);
        let mut op = Op {
            results: vec![Completion::Pending, Completion::Pending].into(),
            waits: vec![],
            cancelled: false,
        };
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| complete(&mut op, 50, 500)))
                .is_err()
        );
    }
    struct Touch {
        steps: Vec<&'static str>,
        baud: u32,
        fail: Option<&'static str>,
    }
    impl Touch {
        fn step(&mut self, s: &'static str) -> Result<(), &'static str> {
            self.steps.push(s);
            if self.fail == Some(s) {
                Err("io_failed")
            } else {
                Ok(())
            }
        }
    }
    impl TouchIo for Touch {
        fn set_rate(&mut self, b: u32) -> Result<(), &'static str> {
            self.baud = b;
            self.step("set")
        }
        fn rate(&mut self) -> Result<u32, &'static str> {
            self.step("verify")?;
            Ok(if self.fail == Some("mismatch") {
                115200
            } else {
                self.baud
            })
        }
        fn clear_dtr(&mut self) -> Result<(), &'static str> {
            self.step("dtr")
        }
        fn close(&mut self) -> Result<(), &'static str> {
            self.step("close")
        }
        fn unconfirmed(&mut self) -> ! {
            panic!("unconfirmed close retains lease");
        }
    }
    #[test]
    fn both_touch_rates_use_identical_verified_sequence_and_close_once_on_error() {
        for baud in [1200, 1201] {
            for fail in [
                None,
                Some("set"),
                Some("verify"),
                Some("mismatch"),
                Some("dtr"),
            ] {
                let mut io = Touch {
                    steps: vec![],
                    baud: 115200,
                    fail,
                };
                assert_eq!(touch(&mut io, baud, || Ok(())).is_ok(), fail.is_none());
                assert_eq!(io.steps.iter().filter(|s| **s == "close").count(), 1);
                if fail.is_none() {
                    assert_eq!(io.steps, ["set", "verify", "dtr", "close"]);
                }
                if fail == Some("mismatch") {
                    assert!(!io.steps.contains(&"dtr"));
                }
            }
        }
        let mut io = Touch {
            steps: vec![],
            baud: 115200,
            fail: None,
        };
        assert_eq!(
            touch(&mut io, 1200, || Err("stale_device")),
            Err("stale_device")
        );
        assert_eq!(io.steps, ["close"]);
    }
    #[test]
    fn failed_touch_close_cannot_acknowledge_or_release_the_lease() {
        let mut io = Touch {
            steps: vec![],
            baud: 115200,
            fail: Some("close"),
        };
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| touch(
                &mut io,
                1201,
                || Ok(())
            )))
            .is_err()
        );
        assert_eq!(io.steps, ["set", "verify", "dtr", "close"]);
    }
}
