#![cfg(feature = "synthetic-hid")]
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    time::Duration,
};
static LEASE_TEST: std::sync::Mutex<()> = std::sync::Mutex::new(());
struct Peer {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
    id: u64,
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
        let mut peer = Self {
            input: child.stdin.take(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            id: 0,
        };
        let hello=peer.call("hello",json!({"protocol":1,"hostVersion":env!("KEYLOOM_RELEASE"),"target":env!("KEYLOOM_TARGET")}));
        assert_eq!(hello["ok"], true);
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
                    vec!["hid.list", "hid.open", "hid.write"]
                }
            )
        );
        peer
    }
    fn send(&mut self, method: &str, params: Value) -> String {
        self.id += 1;
        let id = self.id.to_string();
        writeln!(
            self.input.as_mut().unwrap(),
            "{}",
            json!({"v":1,"type":"request","id":id,"method":method,"params":params})
        )
        .unwrap();
        id
    }
    fn read(&mut self) -> Value {
        let mut line = String::new();
        assert!(
            self.output.read_line(&mut line).unwrap() > 0,
            "missing frame"
        );
        serde_json::from_str(&line).unwrap()
    }
    fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.send(method, params);
        let response = self.read();
        assert_eq!(response["id"], id);
        response
    }
    fn reference(&mut self) -> String {
        self.call("list", json!({"transport":"hid"}))["result"]["devices"][0]["deviceRef"]
            .as_str()
            .unwrap()
            .to_owned()
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[test]
fn shared_malformed_corpus_has_zero_native_effects() {
    let mut peer = Peer::new();
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../test/fixtures/device-helper/hid-requests.json"
    ))
    .unwrap();
    for case in corpus
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["valid"] == false)
    {
        let response = peer.call(
            case["request"]["method"].as_str().unwrap(),
            case["request"]["params"].clone(),
        );
        assert_eq!(response["ok"], false);
        assert_eq!(
            response["error"],
            json!({"code":"invalid_request","effect":"none","retry":"never"})
        );
    }
    let stats = peer.call("test.stats", json!({}));
    assert_eq!(stats["result"], json!({"opens":0,"writes":0}));
    let schema: Value =
        serde_json::from_str(include_str!("../protocol/transport-v1.schema.json")).unwrap();
    assert_eq!(schema["x-maxPending"], 32);
    assert_eq!(schema["x-maxSessions"], 8);
}
#[test]
fn unread_stdout_causes_sticky_overflow_not_complete_capture() {
    let _guard = LEASE_TEST.lock().unwrap();
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let mut peer = Peer::new();
    let reference = peer.reference();
    let open = peer.call("hid.open", json!({"deviceRef":reference}));
    let session = open["result"]["sessionId"].clone();
    let id = peer.send(
        "session.write",
        json!({"sessionId":session,"reportId":0,"bytes":STANDARD.encode([252u8;32])}),
    );
    // A real unread pipe, not an auto-draining runtime stream. Keep stdin explicitly owned.
    std::thread::sleep(Duration::from_millis(150));
    let mut seq = 0;
    let mut failed = false;
    let mut response = false;
    loop {
        let value = peer.read();
        if value["type"] == "response" {
            assert_eq!(value["id"], id);
            response = true;
            continue;
        }
        seq += 1;
        assert_eq!(value["seq"], seq);
        match value["event"].as_str().unwrap() {
            "data" => assert!(!failed),
            "failed" => {
                assert!(!failed);
                assert_eq!(value["error"]["code"], "overflow");
                assert_eq!(value["loss"], "detected");
                failed = true;
            }
            "closed" => {
                assert_eq!(value["reason"], "failed");
                break;
            }
            _ => panic!("unknown event"),
        }
    }
    assert!(failed && response);
    assert!(seq <= 1026);
    let close = peer.call("session.close", json!({"sessionId":session}));
    assert_eq!(close["result"]["finalSeq"], seq);
}
#[test]
fn lost_response_proves_one_effect_attempt_without_payload_logs() {
    let _guard = LEASE_TEST.lock().unwrap();
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::io::Read;
    let mut peer = Peer::new();
    let reference = peer.reference();
    peer.send(
        "hid.write",
        json!({"deviceRef":reference,"reportId":0,"bytes":STANDARD.encode([251u8;32])}),
    );
    let mut stdout = String::new();
    peer.output.read_to_string(&mut stdout).unwrap();
    assert!(stdout.is_empty());
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

#[test]
fn references_and_sessions_from_a_previous_helper_are_invalid() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut first = Peer::new();
    let old_ref = first.reference();
    let old_session =
        first.call("hid.open", json!({"deviceRef":old_ref}))["result"]["sessionId"].clone();
    first.send("session.close", json!({"sessionId":old_session}));
    assert_eq!(first.read()["event"], "closed");
    assert_eq!(first.read()["ok"], true);
    let mut second = Peer::new();
    let new_ref = second.reference();
    assert_ne!(old_ref, new_ref);
    let stale = second.call("hid.open", json!({"deviceRef":old_ref}));
    assert_eq!(stale["error"]["code"], "stale_device");
    let stale = second.call("session.close", json!({"sessionId":old_session}));
    assert_eq!(stale["error"]["code"], "invalid_session");
    assert_eq!(
        second.call("test.stats", json!({}))["result"],
        json!({"opens":0,"writes":0})
    );
    let new_session =
        second.call("hid.open", json!({"deviceRef":new_ref}))["result"]["sessionId"].clone();
    assert_ne!(old_session, new_session);
}

#[test]
fn stalled_stdout_exits_despite_continued_observed_pings() {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::{
        io::Read,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        time::Instant,
    };
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    let reference = peer.reference();
    let opened = peer.call("hid.open", json!({"deviceRef":reference}));
    assert_eq!(opened["ok"], true);
    let started = Instant::now();
    peer.send("session.write",json!({"sessionId":opened["result"]["sessionId"],"reportId":0,"bytes":STANDARD.encode([252u8;32])}));
    // Do not read stdout again. Rust owns the actual OS pipe; no runtime prefetcher exists.
    let mut stdin = peer.input.take().unwrap();
    let mut id = peer.id;
    let stop = Arc::new(AtomicBool::new(false));
    let producer_stop = stop.clone();
    let producer = std::thread::spawn(move || {
        while !producer_stop.load(Ordering::Acquire) {
            id += 1;
            if writeln!(
                stdin,
                "{}",
                json!({"v":1,"type":"request","id":id.to_string(),"method":"ping","params":{}})
            )
            .is_err()
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        // Ownership remains here until the main test has observed child exit or killed it.
        while !producer_stop.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(5));
        }
    });
    let mut stderr = peer.child.stderr.take().unwrap();
    let observed = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).unwrap();
        bytes
    });
    let status = loop {
        if let Some(status) = peer.child.try_wait().unwrap() {
            break Some(status);
        }
        if started.elapsed() > Duration::from_millis(6500) {
            break None;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let timed_out = status.is_none();
    if timed_out {
        peer.child.kill().unwrap();
        peer.child.wait().unwrap();
    }
    stop.store(true, Ordering::Release);
    producer.join().unwrap();
    let diagnostics = observed.join().unwrap();
    let pings = diagnostics
        .split(|byte| *byte == b'\n')
        .filter(|line| *line == b"synthetic-ping-observed")
        .count();
    eprintln!(
        "{}",
        json!({"continuedObservedPings":pings,"elapsedMs":started.elapsed().as_millis(),"stdoutNeverDrainedAfterOpen":true,"stdinHeldUntilObservedExit":true,"timedOut":timed_out})
    );
    assert!(
        !timed_out,
        "stdout progress watchdog did not terminate helper"
    );
    assert_eq!(status.and_then(|status| status.code()), Some(1));
    assert!(
        pings >= 8,
        "parent enqueue is not proof: helper must observe continued pings"
    );
    assert!(started.elapsed() >= Duration::from_secs(5));
}

#[test]
fn serial_relist_preserves_hid_refs_and_serial_write_shape_is_refused() {
    let _guard = LEASE_TEST.lock().unwrap();
    let mut peer = Peer::new();
    let reference = peer.reference();
    let serial = peer.call("list", json!({"transport":"serial"}));
    if cfg!(feature = "synthetic-serial") {
        assert_eq!(serial["ok"], true);
    } else {
        assert_eq!(serial["error"]["code"], "unsupported");
    }
    let opened = peer.call("hid.open", json!({"deviceRef":reference}));
    assert_eq!(opened["ok"], true);
    assert_eq!(
        peer.call(
            "session.write",
            json!({"sessionId":opened["result"]["sessionId"],"bytes":"AA=="})
        )["error"]["code"],
        "invalid_request"
    );
    assert_eq!(
        peer.call("test.stats", json!({}))["result"],
        json!({"opens":1,"writes":0})
    );
}
