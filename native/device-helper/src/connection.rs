use crate::backend::{Backend, Device, Endpoint};
use crate::serial::{OpenError, SerialBackend, SerialDevice, SerialEndpoint};
use serde_json::{Value, json};
// The owner normalizes only its control flow; HID retains its fixed-size native contract.
#[allow(dead_code)]
#[derive(Clone)]
pub enum ConnectionBackend {
    Hid(std::sync::Arc<dyn Backend>),
    Serial(std::sync::Arc<dyn SerialBackend>),
}
#[derive(Clone, Debug, PartialEq)]
pub enum ConnectionEndpoint {
    Hid(Endpoint),
    Serial(SerialEndpoint),
}
impl ConnectionEndpoint {
    pub fn transport(&self) -> &'static str {
        match self {
            Self::Hid(_) => "hid",
            Self::Serial(_) => "serial",
        }
    }
    pub fn valid_chunk(&self, bytes: &[u8]) -> bool {
        match self {
            Self::Hid(_) => bytes.len() == 32,
            Self::Serial(_) => (1..=4096).contains(&bytes.len()),
        }
    }
    pub fn lease_key(&self) -> String {
        match self {
            Self::Hid(e) => format!("hid:{}", e.key),
            Self::Serial(e) => format!("serial:{}", e.key),
        }
    }
    pub fn record(&self, reference: &str) -> Result<Value, &'static str> {
        match self {
            Self::Hid(e) => Ok(e.record(reference)),
            Self::Serial(e) => {
                if e.serial
                    .iter()
                    .chain(e.product_name.iter())
                    .any(|s| s.len() > 256)
                {
                    return Err("capacity");
                }
                let mut value = json!({"deviceRef":reference,"transport":"serial","vendorId":e.vendor,"productId":e.product});
                if let Some(serial) = &e.serial {
                    value["serial"] = json!(serial);
                }
                if let Some(product) = &e.product_name {
                    value["product"] = json!(product);
                }
                if let Some(number) = e.interface_number {
                    value["interfaceNumber"] = json!(number);
                }
                Ok(value)
            }
        }
    }
}
pub enum ConnectionDevice {
    Hid(Box<dyn Device>),
    Serial(Box<dyn SerialDevice>),
}
impl ConnectionDevice {
    pub fn write(&mut self, bytes: &[u8]) -> Result<(), &'static str> {
        match self {
            Self::Hid(d) => d.write(bytes.try_into().map_err(|_| "invalid_request")?),
            Self::Serial(d) => d.write(bytes),
        }
    }
    pub fn read(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        match self {
            Self::Hid(d) => d.read().map(|v| v.map(Vec::from)),
            Self::Serial(d) => d.read(),
        }
    }
    pub fn pending(&mut self) -> Result<Option<Vec<u8>>, &'static str> {
        match self {
            Self::Hid(d) => d.pending().map(|v| v.map(Vec::from)),
            Self::Serial(d) => d.pending(),
        }
    }
    pub fn close(&mut self) -> Result<(), &'static str> {
        match self {
            Self::Hid(d) => d.close(),
            Self::Serial(d) => d.close(),
        }
    }
}
impl ConnectionBackend {
    pub fn transport(&self) -> &'static str {
        match self {
            Self::Hid(_) => "hid",
            Self::Serial(_) => "serial",
        }
    }
    pub fn list(&self) -> Result<Vec<ConnectionEndpoint>, &'static str> {
        match self {
            Self::Hid(b) => b
                .list()
                .map(|v| v.into_iter().map(ConnectionEndpoint::Hid).collect()),
            Self::Serial(b) => b
                .list()
                .map(|v| v.into_iter().map(ConnectionEndpoint::Serial).collect()),
        }
    }
    pub fn touch(&self, endpoint: &ConnectionEndpoint, baud: u64) -> Result<(), OpenError> {
        match (self, endpoint) {
            (Self::Serial(b), ConnectionEndpoint::Serial(e)) => b.touch(e, baud),
            _ => Err("unsupported".into()),
        }
    }
    pub fn open(&self, endpoint: &ConnectionEndpoint) -> Result<ConnectionDevice, OpenError> {
        match (self, endpoint) {
            (Self::Hid(b), ConnectionEndpoint::Hid(e)) => b
                .open(e)
                .map(ConnectionDevice::Hid)
                .map_err(OpenError::from),
            (Self::Serial(b), ConnectionEndpoint::Serial(e)) => {
                b.open(e).map(ConnectionDevice::Serial)
            }
            _ => Err("unsupported".into()),
        }
    }
    #[cfg(any(feature = "synthetic-hid", feature = "synthetic-serial"))]
    pub fn test_stats(&self) -> Value {
        match self {
            Self::Hid(b) => b.test_stats(),
            Self::Serial(b) => b.test_stats(),
        }
    }
}
