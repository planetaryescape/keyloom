#![cfg(not(any(feature = "native-hid", feature = "synthetic-hid")))]
// Real OS-pipe backpressure for the diagnostics build, not a runtime-buffered stdout stream.
// Based on the run-owned adversarial pipe probe; stdin ownership is deliberately explicit.
use std::io::{Read, Write};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const EXIT_BUDGET: Duration = Duration::from_millis(6500);
const CLEANUP_BUDGET: Duration = Duration::from_secs(2);
const PINGS: usize = 20_000;

fn wait_until(child: &mut Child, deadline: Instant) -> Option<ExitStatus> {
    loop {
        if let Some(status) = child.try_wait().expect("observe the owned child") {
            return Some(status);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn blocked_stdout(close_stderr: bool) {
    let (unread, writer) = std::io::pipe().expect("private OS pipe");
    let started = Instant::now();
    let mut child = Command::new(env!("CARGO_BIN_EXE_keyloom-device"))
        .arg("--stdio")
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(writer)
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn the real diagnostics helper");
    let mut diagnostics = child.stderr.take();
    if close_stderr {
        // A closed reader produces EPIPE, unlike a null sink that silently accepts writes.
        drop(diagnostics.take());
    }
    let mut stdin = child.stdin.take().expect("private input pipe");
    let (release_input, hold_input) = mpsc::channel::<()>();
    let producer = std::thread::spawn(move || {
        let hello = serde_json::json!({"v":1,"type":"request","id":"1","method":"hello",
            "params":{"protocol":1,"hostVersion":env!("KEYLOOM_RELEASE"),"target":env!("KEYLOOM_TARGET")}});
        let mut queued = 0;
        if writeln!(stdin, "{hello}").is_ok() {
            for id in 2..=PINGS + 1 {
                if writeln!(stdin, "{{\"v\":1,\"type\":\"request\",\"id\":\"{id}\",\"method\":\"ping\",\"params\":{{}}}}").is_err() {
                    break;
                }
                queued += 1;
            }
        }
        // Even if all requests fit, EOF must NOT be the reason the helper exits.
        let _ = hold_input.recv();
        drop(stdin);
        queued
    });

    let mut status = wait_until(&mut child, started + EXIT_BUDGET);
    let timed_out = status.is_none();
    if timed_out {
        let _ = child.kill();
        status = wait_until(&mut child, Instant::now() + CLEANUP_BUDGET);
    }
    let elapsed = started.elapsed();
    // This reader was never read, including during exit observation. No Bun/Node buffering exists.
    drop(unread);
    let _ = release_input.send(());
    let join_deadline = Instant::now() + Duration::from_secs(1);
    while !producer.is_finished() && Instant::now() < join_deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(producer.is_finished(), "owned producer did not finish");
    let queued = producer.join().expect("owned producer completed");
    let mut stderr_bytes = Vec::new();
    if status.is_some()
        && let Some(stderr) = diagnostics
    {
        stderr
            .take(1025)
            .read_to_end(&mut stderr_bytes)
            .expect("bounded closed stderr");
    }
    eprintln!(
        "{}",
        serde_json::json!({"osPipeBackpressure":true,"closedStderr":close_stderr,
        "elapsedMs":elapsed.as_millis(),"queuedPings":queued,"timedOut":timed_out,
        "exitCode":status.and_then(|s| s.code()),"stdinHeldUntilObservedExit":status.is_some(),
        "stdoutWasNeverRead":true,"stderrBytes":stderr_bytes.len()})
    );
    assert!(status.is_some(), "child cleanup unconfirmed");
    assert!(!timed_out, "helper exceeded the unchanged OS exit budget");
    assert_eq!(status.and_then(|s| s.code()), Some(1));
    assert!(
        elapsed >= Duration::from_secs(5),
        "early protocol/error exit is not watchdog evidence"
    );
    assert!(
        queued > 0 && queued < PINGS,
        "producer did not encounter real pipe backpressure"
    );
    assert!(stderr_bytes.len() <= 1024);
}

#[test]
fn unread_stdout_pipe_exits_without_parent_drain() {
    blocked_stdout(false);
}

#[test]
fn unread_stdout_pipe_with_closed_stderr_exits_without_parent_drain() {
    blocked_stdout(true);
}

#[test]
fn closed_stderr_preserves_fatal_protocol_exit_code() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_keyloom-device"))
        .arg("--stdio")
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn diagnostics helper");
    drop(child.stderr.take());
    child
        .stdin
        .take()
        .expect("input pipe")
        .write_all(b"not-json\n")
        .expect("small synthetic input");
    let mut status = wait_until(&mut child, Instant::now() + EXIT_BUDGET);
    let timed_out = status.is_none();
    if timed_out {
        let _ = child.kill();
        status = wait_until(&mut child, Instant::now() + CLEANUP_BUDGET);
    }
    assert!(!timed_out, "fatal protocol exit exceeded its budget");
    assert_eq!(status.and_then(|s| s.code()), Some(1));
}
