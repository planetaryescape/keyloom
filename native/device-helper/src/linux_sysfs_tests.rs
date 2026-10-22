use super::*;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::sync::atomic::{AtomicU64, Ordering};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Tree(PathBuf);
impl Tree {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "keyloom-sysfs-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn endpoint(&self, name: &str, serial: Option<&str>) -> PathBuf {
        let usb = self.0.join(format!("hub/usb-{name}"));
        let interface = usb.join("interface");
        let device = interface.join("hid");
        fs::create_dir_all(&device).unwrap();
        for (file, value) in [
            ("idVendor", "16c0"),
            ("idProduct", "27db"),
            ("product", "Fake Keyboard"),
        ] {
            fs::write(usb.join(file), value).unwrap();
        }
        if let Some(serial) = serial {
            fs::write(usb.join("serial"), serial).unwrap();
        }
        fs::write(interface.join("bInterfaceNumber"), "01").unwrap();
        fs::write(device.join("uevent"), "HID_UNIQ=untrusted\n").unwrap();
        fs::write(device.join("report_descriptor"), [1, 2, 3]).unwrap();
        fs::create_dir_all(self.0.join("class").join(name)).unwrap();
        symlink(&device, self.0.join("class").join(name).join("device")).unwrap();
        usb
    }
    fn list(&self, hid: bool) -> Vec<Record> {
        discover(&self.0.join("class"), &self.0.join("dev"), hid).unwrap()
    }
}
impl Drop for Tree {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
#[test]
fn missing_serial_never_inherits_from_hub_and_duplicates_stay_distinct() {
    let t = Tree::new();
    t.endpoint("hidraw0", None);
    for (f, v) in [
        ("idVendor", "ffff"),
        ("idProduct", "ffff"),
        ("serial", "hub-serial"),
    ] {
        fs::write(t.0.join("hub").join(f), v).unwrap();
    }
    t.endpoint("hidraw1", Some("duplicate"));
    t.endpoint("hidraw2", Some("duplicate"));
    let r = t.list(true);
    assert_eq!(r.len(), 3);
    let missing = r.iter().find(|r| r.node.ends_with("hidraw0")).unwrap();
    assert_eq!(missing.serial, None);
    assert_eq!((missing.vendor, missing.product), (0x16c0, 0x27db));
    assert_eq!(missing.interface, Some(1));
    assert_ne!(r[1].key(), r[2].key());
}
#[test]
fn renumbering_dangling_links_and_node_permissions_do_not_require_by_id_or_open() {
    let t = Tree::new();
    t.endpoint("ttyACM0", Some("same"));
    let first = t.list(false).remove(0);
    fs::rename(t.0.join("class/ttyACM0"), t.0.join("class/ttyACM7")).unwrap();
    fs::create_dir_all(t.0.join("class/ttyACM8")).unwrap();
    symlink(t.0.join("gone"), t.0.join("class/ttyACM8/device")).unwrap();
    fs::create_dir_all(t.0.join("dev")).unwrap();
    let node = t.0.join("dev/ttyACM7");
    fs::write(&node, []).unwrap();
    fs::set_permissions(&node, fs::Permissions::from_mode(0o0)).unwrap();
    let next = t.list(false);
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].serial, first.serial);
    assert_ne!(next[0].key(), first.key());
    assert_eq!(next[0].device, first.device);
}
#[test]
fn report_id_is_added_only_to_output_and_no_read_byte_is_discarded() {
    let payload = std::array::from_fn(|i| i as u8 + 1);
    let report = output_report(&payload);
    assert_eq!(report.len(), 33);
    assert_eq!(report[0], 0);
    assert_eq!(&report[1..], payload);
    assert_eq!(input_report(&payload), Ok(payload));
    assert!(input_report(&report).is_err());
    assert!(input_report(&payload[..31]).is_err());
}

#[test]
fn malformed_owner_ids_cannot_fall_through_to_a_hub() {
    let t = Tree::new();
    let usb = t.endpoint("ttyACM0", None);
    for (f, v) in [
        ("idVendor", "ffff"),
        ("idProduct", "ffff"),
        ("serial", "hub-serial"),
    ] {
        fs::write(t.0.join("hub").join(f), v).unwrap();
    }
    fs::write(usb.join("idVendor"), "not-hex").unwrap();
    fs::write(usb.join("idProduct"), "").unwrap();
    assert_eq!(
        discover(&t.0.join("class"), &t.0.join("dev"), false),
        Err("io_failed")
    );
}
