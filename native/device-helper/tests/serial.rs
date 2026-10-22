#![cfg(feature = "synthetic-serial")]
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc,
    time::Duration,
};
static LEASE_TEST: std::sync::Mutex<()> = std::sync::Mutex::new(());
struct Peer {
    child: Child,
    input: ChildStdin,
    frames: mpsc::Receiver<Value>,
    id: u64,
    queued: VecDeque<Value>,
}
impl Peer {
    fn new() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_keyloom-device"))
            .arg("--stdio")
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        // Bounded receiver leaves the OS pipe unread in overflow tests; every read has a deadline.
        let (send, frames) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else {
                    break;
                };
                if send.send(serde_json::from_str(&line).unwrap()).is_err() {
                    break;
                }
            }
        });
        let mut peer = Self {
            child,
            input,
            frames,
            id: 0,
            queued: VecDeque::new(),
        };
        let hello = peer.call("hello",json!({"protocol":1,"hostVersion":env!("KEYLOOM_RELEASE"),"target":env!("KEYLOOM_TARGET")}));
        assert_eq!(
            hello["result"]["capabilities"],
            json!(
                if cfg!(all(feature = "synthetic-hid", feature = "synthetic-serial")) {
                    vec![
                        "hid.list",
                        "hid.open",
                        "hid.write",
                        "serial.list",
                        "serial.open",
                        "serial.touch.1200",
                        "serial.touch.1201",
                    ]
                } else {
                    vec![
                        "serial.list",
                        "serial.open",
                        "serial.touch.1200",
                        "serial.touch.1201",
                    ]
                }
            )
        );
        peer
    }
    fn send(&mut self, method: &str, params: Value) -> String {
        self.id += 1;
        let id = self.id.to_string();
        writeln!(
            self.input,
            "{}",
            json!({"v":1,"type":"request","id":id,"method":method,"params":params})
        )
        .unwrap();
        id
    }
    fn read(&mut self) -> Value {
        if let Some(value) = self.queued.pop_front() {
            return value;
        }
        self.frames
            .recv_timeout(Duration::from_secs(3))
            .expect("bounded helper reply")
    }
    fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.send(method, params);
        loop {
            let v = self
                .frames
                .recv_timeout(Duration::from_secs(3))
                .expect("bounded helper reply");
            if v["type"] == "event" {
                self.queued.push_back(v);
                continue;
            }
            assert_eq!(v["id"], id);
            return v;
        }
    }
    fn reference(&mut self) -> String {
        let reply = self.call("list", json!({"transport":"serial"}));
        let device = &reply["result"]["devices"][0];
        assert_eq!(device["serial"], "keyloom/NPQRSTVWXYZ0-L");
        assert!(device.get("usagePage").is_none());
        device["deviceRef"].as_str().unwrap().to_owned()
    }
    fn open(&mut self) -> Value {
        let reference = self.reference();
        let reply = self.call("serial.open", json!({"deviceRef":reference}));
        assert_eq!(reply["ok"], true);
        assert!(
            self.queued.is_empty(),
            "open reply must precede every data event"
        );
        reply["result"]["sessionId"].clone()
    }
    #[cfg(feature = "synthetic-serial-capture")]
    fn close(&mut self, session: &Value, seq: u64) {
        let id = self.send("session.close", json!({"sessionId":session}));
        let closed = self.read();
        assert_eq!(closed["event"], "closed");
        assert_eq!(closed["seq"], seq);
        let reply = self.read();
        assert_eq!(reply["id"], id);
        assert_eq!(reply["result"]["finalSeq"], seq);
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[test]
fn shared_invalid_requests_have_zero_effects_and_touch_checks_refs() {
    let mut peer = Peer::new();
    let cases: Value = serde_json::from_str(include_str!(
        "../../../test/fixtures/device-helper/serial-requests.json"
    ))
    .unwrap();
    for case in cases
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["valid"] == false)
    {
        let reply = peer.call(
            case["request"]["method"].as_str().unwrap(),
            case["request"]["params"].clone(),
        );
        assert_eq!(
            reply["error"]["code"], "invalid_request",
            "{}",
            case["name"]
        );
        assert_eq!(reply["error"]["effect"], "none");
    }
    assert_eq!(
        peer.call("test.stats", json!({"transport":"serial"}))["result"],
        json!({"opens":0,"writes":0})
    );
    assert_eq!(
        peer.call("serial.touch", json!({"deviceRef":"d1","baud":1200}))["error"],
        json!({"code":"stale_device","effect":"none","retry":"after_rediscovery"})
    );
}
#[test]
fn chunks_preserve_bytes_limits_and_close_drains_before_receipt() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    let session = peer.open();
    let mut seq = 0;
    for size in [1, 32, 100, 4096] {
        let bytes = vec![128; size];
        let reply = peer.call(
            "session.write",
            json!({"sessionId":session,"bytes":STANDARD.encode(&bytes)}),
        );
        assert_eq!(reply["result"]["acceptedBytes"], size);
        let event = peer.read();
        seq += 1;
        assert_eq!(event["seq"], seq);
        assert_eq!(event["event"], "data");
        assert_eq!(
            STANDARD.decode(event["bytes"].as_str().unwrap()).unwrap(),
            bytes
        );
    }
    for bytes in [vec![], vec![0; 4097]] {
        assert_eq!(
            peer.call(
                "session.write",
                json!({"sessionId":session,"bytes":STANDARD.encode(bytes)})
            )["error"]["code"],
            "invalid_request"
        );
    }
    assert_eq!(
        peer.call(
            "session.write",
            json!({"sessionId":session,"reportId":0,"bytes":STANDARD.encode([0;32])})
        )["error"]["code"],
        "invalid_request"
    );
    let id = peer.send(
        "session.write",
        json!({"sessionId":session,"bytes":STANDARD.encode(b"tail")}),
    );
    let close = peer.send("session.close", json!({"sessionId":session}));
    let mut data = false;
    loop {
        let frame = peer.read();
        if frame["id"] == id {
            assert_eq!(frame["ok"], true);
        } else if frame["event"] == "data" {
            seq += 1;
            assert_eq!(frame["seq"], seq);
            data = true;
        } else if frame["event"] == "closed" {
            seq += 1;
            assert!(data);
            assert_eq!(frame["seq"], seq);
        } else {
            assert_eq!(frame["id"], close);
            assert_eq!(frame["result"]["finalSeq"], seq);
            break;
        }
    }
    assert_eq!(
        peer.call("session.close", json!({"sessionId":session}))["result"]["finalSeq"],
        seq
    );
}
#[test]
fn refs_relist_by_transport_and_new_writes_are_refused_during_close() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    // A relist that finds the same endpoint keeps its reference, so another caller's list
    // between this caller's list and open does not invalidate it.
    let old = peer.reference();
    let new = peer.reference();
    assert_eq!(old, new);
    let hid = peer.call("list", json!({"transport":"hid"}));
    if cfg!(feature = "synthetic-hid") {
        assert_eq!(hid["ok"], true);
    } else {
        assert_eq!(hid["error"]["code"], "unsupported");
    }
    let session = peer.call("serial.open", json!({"deviceRef":new}))["result"]["sessionId"].clone();
    assert!(session.is_string());
    let close = peer.send("session.close", json!({"sessionId":session}));
    let write = peer.send("session.write", json!({"sessionId":session,"bytes":"AA=="}));
    let mut closed = false;
    let mut receipt = false;
    let mut refused = false;
    for _ in 0..3 {
        let v = peer.read();
        if v["event"] == "closed" {
            closed = true;
        } else if v["id"] == close {
            assert!(closed);
            receipt = true;
        } else {
            assert_eq!(v["id"], write);
            assert_eq!(v["error"]["code"], "invalid_session");
            refused = true;
        }
    }
    assert!(closed && receipt && refused);
}
#[test]
fn overflow_during_close_is_sticky_and_has_a_final_sequence() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    let session = peer.open();
    let write = peer.send(
        "session.write",
        json!({"sessionId":session,"bytes":STANDARD.encode([252])}),
    );
    let close = peer.send("session.close", json!({"sessionId":session}));
    std::thread::sleep(Duration::from_millis(150));
    let mut seq = 0;
    let mut failed = false;
    let mut closed = false;
    let mut written = false;
    loop {
        let v = peer.read();
        if v["id"] == write {
            assert_eq!(v["ok"], true);
            written = true;
            continue;
        }
        if v["id"] == close {
            assert!(closed && failed && written);
            assert_eq!(v["result"]["finalSeq"], seq);
            break;
        }
        seq += 1;
        assert_eq!(v["seq"], seq);
        match v["event"].as_str().unwrap() {
            "data" => assert!(!failed),
            "failed" => {
                assert!(!failed);
                assert_eq!(v["loss"], "detected");
                assert_eq!(v["error"]["code"], "overflow");
                failed = true;
            }
            "closed" => {
                assert!(failed);
                assert_eq!(v["reason"], "failed");
                closed = true;
            }
            _ => panic!("unexpected event"),
        }
    }
    // Output capacity is 16; one frame may be in the writer, two in the bounded test reader, plus the OS pipe.
    assert!(seq < 40);
}
#[test]
fn helper_exit_after_write_has_one_attempt_and_no_reply_or_payload_log() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    let session = peer.open();
    peer.send(
        "session.write",
        json!({"sessionId":session,"bytes":STANDARD.encode([251])}),
    );
    assert!(peer.frames.recv_timeout(Duration::from_secs(3)).is_err());
    assert_eq!(peer.child.wait().unwrap().code(), Some(1));
    let mut stderr = String::new();
    peer.child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    assert_eq!(stderr, "synthetic-write-attempt:1\n");
}
#[cfg(feature = "synthetic-serial-capture")]
#[test]
fn firmware_capture_is_split_mid_line_after_the_open_reply() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    let session = peer.open();
    assert_eq!(
        peer.call(
            "session.write",
            json!({"sessionId":session,"bytes":STANDARD.encode(b"KLTYPE START\n")})
        )["ok"],
        true
    );
    let chunks = (0..3)
        .map(|_| {
            let v = peer.read();
            STANDARD.decode(v["bytes"].as_str().unwrap()).unwrap()
        })
        .collect::<Vec<_>>();
    assert_eq!(chunks[1], b"E 30 1 10");
    assert_eq!(
        chunks.concat(),
        b"KLTYPE ON 1000\nE 30 1 1030 255\nE 30 0 1070 255\n"
    );
    peer.close(&session, 4);
}
#[test]
fn close_failure_never_publishes_a_release_receipt() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    let session = peer.open();
    assert_eq!(
        peer.call(
            "session.write",
            json!({"sessionId":session,"bytes":STANDARD.encode([249])})
        )["ok"],
        true
    );
    peer.send("session.close", json!({"sessionId":session}));
    assert!(peer.frames.recv_timeout(Duration::from_secs(3)).is_err());
    assert_eq!(peer.child.wait().unwrap().code(), Some(1));
}

#[test]
fn write_failure_is_terminal_and_never_replayed() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    let session = peer.open();
    let id = peer.send(
        "session.write",
        json!({"sessionId":session,"bytes":STANDARD.encode([250])}),
    );
    let reply = peer.read();
    assert_eq!(reply["id"], id);
    assert_eq!(reply["error"]["code"], "io_failed");
    assert_eq!(reply["error"]["effect"], "possible");
    let failed = peer.read();
    assert_eq!(failed["event"], "failed");
    assert_eq!(failed["seq"], 1);
    assert_eq!(failed["loss"], "unknown");
    let closed = peer.read();
    assert_eq!(closed["event"], "closed");
    assert_eq!(closed["seq"], 2);
    assert_eq!(closed["reason"], "failed");
    assert_eq!(
        peer.call("test.stats", json!({"transport":"serial"}))["result"],
        json!({"opens":1,"writes":1})
    );
    assert_eq!(
        peer.call("session.close", json!({"sessionId":session}))["result"]["finalSeq"],
        2
    );
}

#[test]
fn touch_is_leased_rechecks_refs_and_never_opens_when_busy() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    let reference = peer.reference();
    for baud in [1200, 1201] {
        let reply = peer.call("serial.touch", json!({"deviceRef":reference,"baud":baud}));
        assert_eq!(reply["result"], json!({"lineStateApplied":true}));
    }
    let session =
        peer.call("serial.open", json!({"deviceRef":reference}))["result"]["sessionId"].clone();
    let before = peer.call("test.stats", json!({"transport":"serial"}))["result"].clone();
    let busy = peer.call("serial.touch", json!({"deviceRef":reference,"baud":1200}));
    assert_eq!(
        busy["error"],
        json!({"code":"busy","effect":"none","retry":"after_user_action"})
    );
    assert_eq!(
        peer.call("test.stats", json!({"transport":"serial"}))["result"],
        before
    );
    let mut other = Peer::new();
    let other_ref = other.reference();
    assert_eq!(
        other.call("serial.touch", json!({"deviceRef":other_ref,"baud":1201}))["error"]["code"],
        "busy"
    );
    peer.call("session.close", json!({"sessionId":session}));
    // The relist finds the same endpoint, so the caller's reference stays valid (D-433).
    assert_eq!(peer.reference(), reference);
    assert_eq!(
        peer.call("serial.touch", json!({"deviceRef":reference,"baud":1200}))["result"],
        json!({"lineStateApplied":true})
    );
    assert_eq!(
        peer.call("serial.touch", json!({"deviceRef":other_ref,"baud":1200}))["error"]["code"],
        "stale_device"
    );
}
