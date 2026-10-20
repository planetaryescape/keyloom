// Default builds remain diagnostics. Native and synthetic implementations are compile-time exclusive.
#[cfg(all(feature = "native-hid", feature = "synthetic-hid"))]
compile_error!("synthetic and production backends must never coexist");
#[cfg(any(feature = "native-hid", feature = "synthetic-hid"))]
mod backend;
#[cfg(all(feature = "native-hid", target_os = "macos"))]
mod macos;
#[cfg(any(feature = "native-hid", feature = "synthetic-hid"))]
mod transport;

fn capabilities() -> Vec<&'static str> {
    if cfg!(feature = "synthetic-hid") || cfg!(all(feature = "native-hid", target_os = "macos")) {
        vec!["hid.list", "hid.open", "hid.write"]
    } else {
        vec![]
    }
}
use serde_json::{Value, json};
#[cfg(not(any(feature = "native-hid", feature = "synthetic-hid")))]
use std::io::Write;
use std::io::{self, BufRead, Read};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

const RELEASE: &str = env!("KEYLOOM_RELEASE");
const TARGET: &str = env!("KEYLOOM_TARGET");
const MAX_FRAME: usize = 65536;
const QUIET: Duration = Duration::from_secs(5);

#[derive(Default)]
struct Protocol {
    ready: bool,
    high_water: u64,
}

fn empty(value: &Value) -> bool {
    value.as_object().is_some_and(|v| v.is_empty())
}

fn refusal(id: &str, code: &str) -> Value {
    json!({"v":1,"type":"response","id":id,"ok":false,
        "error":{"code":code,"effect":"none","retry":"never"}})
}

impl Protocol {
    fn handle(&mut self, value: Value) -> Result<(Value, bool), ()> {
        let object = value.as_object().ok_or(())?;
        if object.len() != 5 || value["v"].as_f64() != Some(1.0) || value["type"] != "request" {
            return Err(());
        }
        let id = value["id"].as_str().ok_or(())?;
        if id.is_empty()
            || id.len() > 20
            || id.starts_with('0')
            || !id.bytes().all(|c| c.is_ascii_digit())
        {
            return Err(());
        }
        let number: u64 = id.parse().map_err(|_| ())?;
        if number <= self.high_water {
            return Err(());
        }
        self.high_water = number;
        let method = value["method"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 64)
            .ok_or(())?;
        let params = &value["params"];
        if !params.is_object() {
            return Err(());
        }
        if !self.ready && method != "hello" {
            return Err(());
        }
        let result = match method {
            "hello" => {
                if self.ready {
                    return Err(());
                }
                if params.as_object().unwrap().len() != 3
                    || params["protocol"].as_f64() != Some(1.0)
                    || !params["hostVersion"].is_string()
                    || !params["target"].is_string()
                {
                    return Ok((refusal(id, "invalid_request"), true));
                }
                if params["hostVersion"] != RELEASE || params["target"] != TARGET {
                    return Ok((refusal(id, "version_mismatch"), true));
                }
                self.ready = true;
                json!({"protocol":1,"helperVersion":RELEASE,"target":TARGET,"capabilities":capabilities()})
            }
            "ping" | "shutdown" => {
                if !empty(params) {
                    return Ok((refusal(id, "invalid_request"), false));
                }
                json!({})
            }
            _ => return Ok((refusal(id, "unsupported"), false)),
        };
        Ok((
            json!({"v":1,"type":"response","id":id,"ok":true,"result":result}),
            method == "shutdown",
        ))
    }
}

// Read no more than the frame limit even if a peer never sends a newline.
fn frame(reader: &mut impl BufRead) -> Result<Option<Value>, ()> {
    let mut bytes = Vec::new();
    let n = reader
        .take((MAX_FRAME + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(|_| ())?;
    if n == 0 {
        return Ok(None);
    }
    if n > MAX_FRAME || bytes.last() != Some(&b'\n') {
        return Err(());
    }
    serde_json::from_slice(&bytes).map(Some).map_err(|_| ())
}

fn serve() -> i32 {
    let alive = Arc::new(Mutex::new(Instant::now()));
    let watchdog = Arc::clone(&alive);
    // No fallible I/O before exit: even closed stderr must not kill only this watchdog thread.
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(50));
            if watchdog.lock().unwrap().elapsed() >= QUIET {
                std::process::exit(1);
            }
        }
    });
    let (send, receive) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut input = io::BufReader::new(io::stdin());
        loop {
            let item = frame(&mut input);
            let done = !matches!(&item, Ok(Some(_)));
            if send.send(item).is_err() || done {
                break;
            }
        }
    });
    let mut protocol = Protocol::default();
    #[cfg(any(feature = "native-hid", feature = "synthetic-hid"))]
    let native_output = transport::Output::start();
    #[cfg(feature = "synthetic-hid")]
    let native = Some(transport::Transport::new(
        Arc::new(backend::synthetic::Synthetic::default()),
        native_output.clone(),
    ));
    #[cfg(all(feature = "native-hid", target_os = "macos"))]
    let native = Some(transport::Transport::new(
        Arc::new(macos::Macos),
        native_output.clone(),
    ));
    #[cfg(all(feature = "native-hid", not(target_os = "macos")))]
    let native: Option<transport::Transport> = None;
    #[cfg(not(any(feature = "native-hid", feature = "synthetic-hid")))]
    let mut output = io::stdout().lock();
    loop {
        let value = match receive.recv_timeout(QUIET) {
            Ok(Ok(Some(value))) => value,
            Ok(Ok(None)) => return 0,
            _ => return 1,
        };
        #[cfg(any(feature = "native-hid", feature = "synthetic-hid"))]
        let request = value.clone();
        let (reply, stop) = match protocol.handle(value) {
            Ok(reply) => reply,
            Err(()) => return 1,
        };
        #[cfg(not(any(feature = "native-hid", feature = "synthetic-hid")))]
        {
            *alive.lock().unwrap() = Instant::now();
        }
        #[cfg(any(feature = "native-hid", feature = "synthetic-hid"))]
        if request["method"] == "hello" || request["method"] == "ping" {
            *alive.lock().unwrap() = Instant::now();
        }
        #[cfg(any(feature = "native-hid", feature = "synthetic-hid"))]
        {
            if reply["error"]["code"] == "unsupported"
                && let Some(native) = &native
            {
                native.handle(
                    request["id"].as_str().unwrap().to_owned(),
                    request["method"].as_str().unwrap(),
                    &request["params"],
                );
                continue;
            }
            if stop {
                if native.as_ref().is_some_and(|n| !n.shutdown()) {
                    return 1;
                }
                native_output.flush(reply.clone());
                return if reply["ok"] == true { 0 } else { 1 };
            }
            native_output.reply(reply);
            continue;
        }
        #[cfg(not(any(feature = "native-hid", feature = "synthetic-hid")))]
        if serde_json::to_writer(&mut output, &reply).is_err()
            || output.write_all(b"\n").is_err()
            || output.flush().is_err()
        {
            return 1;
        }
        #[cfg(not(any(feature = "native-hid", feature = "synthetic-hid")))]
        if stop {
            return if reply["ok"] == true { 0 } else { 1 };
        }
    }
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let code = match args.as_slice() {
        [arg] if arg == "--version" => {
            println!(
                "{}",
                json!({"helperVersion":RELEASE,"protocol":1,"target":TARGET,"capabilities":capabilities(),
                    "syntheticBackend":cfg!(feature="synthetic-hid"),
                    "thirdPartyNotices":include_str!("../THIRD-PARTY-NOTICES.txt")})
            );
            0
        }
        [arg] if arg == "--stdio" => serve(),
        _ => 2,
    };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello() -> Value {
        json!({"v":1,"type":"request","id":"1","method":"hello",
            "params":{"protocol":1,"hostVersion":RELEASE,"target":TARGET}})
    }

    #[test]
    fn canonical_schema_constraints() {
        let schema: Value =
            serde_json::from_str(include_str!("../protocol/v1.schema.json")).unwrap();
        assert_eq!(schema["x-maxFrameBytes"], MAX_FRAME);
        assert_eq!(schema["x-maxRequestId"], u64::MAX.to_string());
        let request = &schema["anyOf"][0];
        assert_eq!(request["properties"]["v"]["const"], 1);
        assert_eq!(request["properties"]["type"]["const"], "request");
        assert_eq!(request["required"].as_array().unwrap().len(), 5);
        assert_eq!(request["additionalProperties"], false);
        assert_eq!(
            schema["$defs"]["helloResult"]["properties"]["capabilities"]["maxItems"],
            0
        );
    }

    #[test]
    fn shared_corpus() {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../test/fixtures/device-helper/requests.json"
        ))
        .unwrap();
        for case in corpus.as_array().unwrap() {
            let mut protocol = Protocol::default();
            protocol.handle(hello()).unwrap();
            let result = protocol.handle(case["request"].clone());
            match case["outcome"].as_str().unwrap() {
                "fatal" => assert!(result.is_err(), "{}", case["name"]),
                "ok" => assert_eq!(result.unwrap().0["ok"], true, "{}", case["name"]),
                code => assert_eq!(result.unwrap().0["error"]["code"], code, "{}", case["name"]),
            }
        }
    }

    #[test]
    fn handshake_order_identity_and_no_replay() {
        let mut protocol = Protocol::default();
        assert!(
            protocol
                .handle(json!({"v":1,"type":"request","id":"1","method":"ping","params":{}}))
                .is_err()
        );
        let mut protocol = Protocol::default();
        assert_eq!(
            protocol.handle(hello()).unwrap().0["result"]["capabilities"],
            json!(capabilities())
        );
        assert!(protocol.handle(hello()).is_err());
        let mut wrong = hello();
        wrong["params"]["target"] = json!("wrong");
        assert_eq!(
            Protocol::default().handle(wrong).unwrap().0["error"]["code"],
            "version_mismatch"
        );
    }

    #[test]
    fn bounded_frames_and_utf8() {
        assert!(frame(&mut io::Cursor::new(vec![b'x'; MAX_FRAME + 1])).is_err());
        assert!(frame(&mut io::Cursor::new(b"{}")).is_err());
        assert!(frame(&mut io::Cursor::new(b"\xff\n")).is_err());
        assert!(frame(&mut io::Cursor::new(b"")).unwrap().is_none());
    }
}
