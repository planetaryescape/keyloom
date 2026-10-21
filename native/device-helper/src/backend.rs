use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq)]
pub struct Endpoint {
    pub key: String,
    pub vendor: u16,
    pub product: u16,
    pub serial: Option<String>,
    pub descriptor: Vec<u8>,
}
impl Endpoint {
    pub fn record(&self, reference: &str) -> Value {
        let mut value = json!({"deviceRef":reference,"transport":"hid","vendorId":self.vendor,
            "productId":self.product,"usagePage":0xff60,"usage":0x61});
        if let Some(serial) = &self.serial {
            value["serial"] = json!(serial);
        }
        value
    }
}

pub trait Device {
    fn write(&mut self, bytes: &[u8; 32]) -> Result<(), &'static str>;
    fn read(&mut self) -> Result<Option<[u8; 32]>, &'static str>;
    fn pending(&mut self) -> Result<Option<[u8; 32]>, &'static str>;
    fn close(&mut self) -> Result<(), &'static str>;
}
pub trait Backend: Send + Sync {
    fn list(&self) -> Result<Vec<Endpoint>, &'static str>;
    fn open(&self, endpoint: &Endpoint) -> Result<Box<dyn Device>, &'static str>;
    #[cfg(feature = "synthetic-hid")]
    fn test_stats(&self) -> Value;
}

// Conservative descriptor admission: unnumbered, single vendor application collection,
// exactly 256 input/output bits. Refuse complex descriptors instead of guessing their shape.
pub fn raw_descriptor(bytes: &[u8]) -> bool {
    let (mut i, mut page, mut usage, mut size, mut count) = (0, 0, 0, 0, 0);
    let (mut depth, mut input, mut output, mut collection) = (0, 0, 0, false);
    while i < bytes.len() {
        let prefix = bytes[i];
        i += 1;
        if prefix == 0xfe {
            return false;
        }
        let len = match prefix & 3 {
            3 => 4,
            n => n as usize,
        };
        if i + len > bytes.len() {
            return false;
        }
        let mut n = 0u32;
        for j in 0..len {
            n |= (bytes[i + j] as u32) << (j * 8);
        }
        i += len;
        match prefix & 0xfc {
            0x04 => page = n,
            0x08 => usage = n,
            0x74 => size = n,
            0x94 => count = n,
            0x84 | 0xa4 | 0xb4 => return false, // report ID / global push/pop
            0xa0 => {
                if depth != 0 || collection || page != 0xff60 || usage != 0x61 || n != 1 {
                    return false;
                }
                depth += 1;
                collection = true;
            }
            0xc0 => {
                if depth != 1 {
                    return false;
                }
                depth -= 1;
            }
            0x80 | 0x90 => {
                if depth != 1 || size != 8 || count != 32 || n & 1 != 0 {
                    return false;
                }
                if prefix & 0xfc == 0x80 {
                    input += 1;
                } else {
                    output += 1;
                }
            }
            0xb0 => return false,
            _ => {}
        }
    }
    depth == 0 && collection && input == 1 && output == 1
}

#[cfg(feature = "synthetic-hid")]
pub mod synthetic {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    pub const DESCRIPTOR: &[u8] = &[
        0x06, 0x60, 0xff, 0x09, 0x61, 0xa1, 1, 0x75, 8, 0x95, 32, 0x09, 0x62, 0x81, 2, 0x09, 0x63,
        0x91, 2, 0xc0,
    ];
    #[derive(Default)]
    pub struct Synthetic {
        pub opens: Arc<AtomicUsize>,
        pub writes: Arc<AtomicUsize>,
    }
    impl Backend for Synthetic {
        fn test_stats(&self) -> Value {
            json!({"opens":self.opens.load(Ordering::SeqCst),"writes":self.writes.load(Ordering::SeqCst)})
        }
        fn list(&self) -> Result<Vec<Endpoint>, &'static str> {
            assert!(raw_descriptor(DESCRIPTOR));
            Ok(vec![Endpoint {
                key: "synthetic-moonlander".into(),
                vendor: 0x3297,
                product: 0x1969,
                serial: Some("keyloom/NPQRSTVWXYZ0".into()),
                descriptor: DESCRIPTOR.to_vec(),
            }])
        }
        fn open(&self, _: &Endpoint) -> Result<Box<dyn Device>, &'static str> {
            self.opens.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(Fake {
                writes: self.writes.clone(),
                queue: std::collections::VecDeque::new(),
                seq: 0,
                close_fail: false,
            }))
        }
    }
    struct Fake {
        writes: Arc<AtomicUsize>,
        queue: std::collections::VecDeque<[u8; 32]>,
        seq: u8,
        close_fail: bool,
    }
    impl Device for Fake {
        fn write(&mut self, bytes: &[u8; 32]) -> Result<(), &'static str> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            if bytes[0] == 0xe8 && &bytes[1..9] == b"KLTYPING" {
                if bytes[9] == 2 {
                    return Ok(());
                }
                let mut status = [0; 32];
                status[0] = 0xe8;
                status[1] = 2;
                status[2] = self.seq;
                status[3] = u8::from(bytes[9] == 1);
                status[5..9].copy_from_slice(&1000u32.to_le_bytes());
                self.queue.push_back(status);
                #[cfg(feature = "synthetic-capture")]
                if bytes[9] == 1 {
                    // Synthetic CLI passage: two firmware-timestamped events, never OS key capture.
                    let mut report = [0; 32];
                    report[0] = 0xe8;
                    report[1] = 1;
                    report[2] = self.seq.wrapping_add(1);
                    report[3] = 2;
                    report[4..8].copy_from_slice(&1030u32.to_le_bytes());
                    report[8] = 30;
                    report[9] = 1;
                    report[12] = 30;
                    report[14..16].copy_from_slice(&40u16.to_le_bytes());
                    self.queue.push_back(report);
                    self.seq = self.seq.wrapping_add(1);
                }
            } else {
                match bytes[0] {
                    249 => self.close_fail = true,
                    250 => return Err("io_failed"),
                    251 => {
                        use std::io::Write;
                        let _ = writeln!(
                            std::io::stderr(),
                            "synthetic-write-attempt:{}",
                            self.writes.load(Ordering::SeqCst)
                        );
                        std::process::exit(1);
                    }
                    252 => self.queue.extend(std::iter::repeat_n([0; 32], 2048)),
                    _ => self.queue.push_back(*bytes),
                }
            }
            self.seq = self.seq.wrapping_add(1);
            Ok(())
        }
        fn read(&mut self) -> Result<Option<[u8; 32]>, &'static str> {
            if let Some(bytes) = self.queue.pop_front() {
                return Ok(Some(bytes));
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
            Ok(None)
        }
        fn pending(&mut self) -> Result<Option<[u8; 32]>, &'static str> {
            Ok(self.queue.pop_front())
        }
        fn close(&mut self) -> Result<(), &'static str> {
            if self.close_fail {
                Err("io_failed")
            } else {
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(all(feature = "synthetic-hid", not(feature = "synthetic-capture")))]
    #[test]
    fn shared_firmware_bytes_match_synthetic_native_reports() {
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        let cases: Value = serde_json::from_str(include_str!(
            "../../../test/fixtures/device-helper/qmk-reports.json"
        ))
        .unwrap();
        let backend = synthetic::Synthetic::default();
        let endpoints = backend.list().unwrap();
        let mut device = backend.open(&endpoints[0]).unwrap();
        for case in cases.as_array().unwrap() {
            let command: [u8; 32] = STANDARD
                .decode(case["command"].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap();
            device.write(&command).unwrap();
            let report = device.read().unwrap().unwrap();
            assert_eq!(STANDARD.encode(report), case["report"].as_str().unwrap());
        }
    }
    #[test]
    fn descriptor_refuses_numbered_truncated_wrong_shape() {
        let d = [
            0x06, 0x60, 0xff, 0x09, 0x61, 0xa1, 1, 0x75, 8, 0x95, 32, 0x81, 2, 0x91, 2, 0xc0,
        ];
        assert!(raw_descriptor(&d));
        for n in 0..d.len() {
            assert!(!raw_descriptor(&d[..n]));
        }
        let mut numbered = d.to_vec();
        numbered.splice(7..7, [0x85, 1]);
        assert!(!raw_descriptor(&numbered));
        let mut wrong = d;
        wrong[10] = 31;
        assert!(!raw_descriptor(&wrong));
    }
}
