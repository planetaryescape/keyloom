#[cfg(any(feature = "synthetic-hid", feature = "synthetic-serial"))]
use serde_json::Value;
#[cfg(feature = "synthetic-serial")]
use serde_json::json;

#[derive(Clone, Debug, PartialEq)]
pub struct SerialEndpoint {
    pub key: String,
    pub permission_denied: bool,
    pub vendor: u16,
    pub product: u16,
    pub serial: Option<String>,
    pub product_name: Option<String>,
    pub interface_number: Option<u8>,
}
pub trait SerialDevice {
    fn write(&mut self, bytes: &[u8]) -> Result<(), &'static str>;
    fn read(&mut self) -> Result<Option<Vec<u8>>, &'static str>;
    fn pending(&mut self) -> Result<Option<Vec<u8>>, &'static str>;
    fn close(&mut self) -> Result<(), &'static str>;
}
#[derive(Debug, PartialEq)]
pub struct OpenError {
    pub code: &'static str,
    pub possible: bool,
}
impl From<&'static str> for OpenError {
    fn from(code: &'static str) -> Self {
        Self {
            code,
            possible: false,
        }
    }
}
pub trait SerialBackend: Send + Sync {
    fn list(&self) -> Result<Vec<SerialEndpoint>, &'static str>;
    fn open(&self, endpoint: &SerialEndpoint) -> Result<Box<dyn SerialDevice>, OpenError>;
    fn touch(&self, _: &SerialEndpoint, _: u64) -> Result<(), OpenError> {
        Err("unsupported".into())
    }
    #[cfg(any(feature = "synthetic-hid", feature = "synthetic-serial"))]
    fn test_stats(&self) -> Value;
}
#[cfg(feature = "synthetic-serial")]
pub mod serial_synthetic {
    use super::*;
    use std::{
        collections::VecDeque,
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
    };
    #[derive(Default)]
    pub struct Synthetic {
        opens: Arc<AtomicUsize>,
        writes: Arc<AtomicUsize>,
    }
    impl SerialBackend for Synthetic {
        fn list(&self) -> Result<Vec<SerialEndpoint>, &'static str> {
            Ok(vec![SerialEndpoint {
                key: "synthetic-glove80-left".into(),
                permission_denied: false,
                vendor: 0x16c0,
                product: 0x27db,
                serial: Some("keyloom/NPQRSTVWXYZ0-L".into()),
                product_name: Some("Synthetic Glove80".into()),
                interface_number: Some(0),
            }])
        }
        fn open(&self, _: &SerialEndpoint) -> Result<Box<dyn SerialDevice>, OpenError> {
            self.opens.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(Fake {
                writes: self.writes.clone(),
                queue: VecDeque::new(),
                flood: 0,
                close_fail: false,
            }))
        }
        fn touch(&self, endpoint: &SerialEndpoint, baud: u64) -> Result<(), OpenError> {
            if !matches!(baud, 1200 | 1201) {
                return Err("invalid_request".into());
            }
            if !self.list()?.contains(endpoint) {
                return Err("stale_device".into());
            }
            self.opens.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn test_stats(&self) -> Value {
            json!({"opens":self.opens.load(Ordering::SeqCst),"writes":self.writes.load(Ordering::SeqCst)})
        }
    }
    struct Fake {
        writes: Arc<AtomicUsize>,
        queue: VecDeque<Vec<u8>>,
        flood: usize,
        close_fail: bool,
    }
    impl SerialDevice for Fake {
        fn write(&mut self, bytes: &[u8]) -> Result<(), &'static str> {
            if !(1..=4096).contains(&bytes.len()) {
                return Err("invalid_request");
            }
            self.writes.fetch_add(1, Ordering::SeqCst);
            if self.queue.len() > 13 {
                return Err("overflow");
            }
            match bytes {
                b"KLTYPE START\n" => {
                    self.queue.push_back(b"KLTYPE ON 1000\n".to_vec());
                    #[cfg(feature = "synthetic-serial-capture")]
                    {
                        self.queue.push_back(b"E 30 1 10".to_vec());
                        self.queue.push_back(b"30 255\nE 30 0 1070 255\n".to_vec());
                    }
                }
                b"KLTYPE STOP\n" => self.queue.push_back(b"KLTYPE OFF 0\n".to_vec()),
                b"KLTYPE PING\n" => {}
                _ => match bytes[0] {
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
                    // Generate on demand: no unbounded fake queue can hide a production queue bug.
                    252 => self.flood = 2048,
                    _ => self.queue.push_back(bytes.to_vec()),
                },
            }
            Ok(())
        }
        fn read(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
            let bytes = self.pending()?;
            if bytes.is_none() {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            Ok(bytes)
        }
        fn pending(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
            if let Some(bytes) = self.queue.pop_front() {
                return Ok(Some(bytes));
            }
            if self.flood > 0 {
                self.flood -= 1;
                return Ok(Some(vec![0; 4096]));
            }
            Ok(None)
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
