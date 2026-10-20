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
    input: ChildStdin,
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
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
            id: 0,
        };
        let hello=peer.call("hello",json!({"protocol":1,"hostVersion":env!("KEYLOOM_RELEASE"),"target":env!("KEYLOOM_TARGET")}));
        assert_eq!(hello["ok"], true);
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
