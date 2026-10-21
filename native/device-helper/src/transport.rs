use crate::backend::{Backend, Endpoint};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::Write,
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

pub fn error(code: &str, effect: &str) -> Value {
    let retry = match code {
        "stale_device" | "not_found" | "ambiguous_device" => "after_rediscovery",
        "busy" | "permission_denied" => "after_user_action",
        _ => "never",
    };
    json!({"code":code,"effect":effect,"retry":retry})
}
fn ok(id: &str, result: Value) -> Value {
    json!({"v":1,"type":"response","id":id,"ok":true,"result":result})
}
fn fail(id: &str, code: &str, effect: &str) -> Value {
    json!({"v":1,"type":"response","id":id,"ok":false,"error":error(code,effect)})
}
struct Control {
    values: Vec<Value>,
    drain: bool,
    ack: Option<mpsc::SyncSender<()>>,
}
#[derive(Clone)]
pub struct Output {
    control: mpsc::SyncSender<Control>,
    data: mpsc::SyncSender<Value>,
    pending: Arc<Mutex<HashSet<String>>>,
    control_frames: Arc<std::sync::atomic::AtomicUsize>,
}
impl Output {
    pub fn start() -> Self {
        let (control, controls) = mpsc::sync_channel::<Control>(64);
        let (data, events) = mpsc::sync_channel::<Value>(510);
        let pending = Arc::new(Mutex::new(HashSet::new()));
        let inflight = pending.clone();
        let control_frames = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let queued = control_frames.clone();
        // Parent pings cannot refresh this independent output-progress deadline.
        let writing = Arc::new(Mutex::new(None::<Instant>));
        let stalled = writing.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_millis(50));
                if stalled
                    .lock()
                    .unwrap()
                    .is_some_and(|at| at.elapsed() >= Duration::from_secs(5))
                {
                    std::process::exit(1); // Fatal paths perform no diagnostic I/O.
                }
            }
        });
        std::thread::spawn(move || {
            let mut stdout = std::io::stdout().lock();
            let write = |value: Value, stdout: &mut std::io::StdoutLock<'_>| {
                *writing.lock().unwrap() = Some(Instant::now());
                if serde_json::to_writer(&mut *stdout, &value).is_err()
                    || stdout.write_all(b"\n").is_err()
                    || stdout.flush().is_err()
                {
                    std::process::exit(1);
                }
                *writing.lock().unwrap() = None;
                if value["type"] == "response"
                    && let Some(id) = value["id"].as_str()
                {
                    inflight.lock().unwrap().remove(id);
                }
            };
            loop {
                match controls.try_recv() {
                    Ok(message) => {
                        if message.drain {
                            for value in events.try_iter().take(1024) {
                                write(value, &mut stdout);
                            }
                        }
                        for value in message.values {
                            write(value, &mut stdout);
                            queued.fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
                        }
                        if let Some(ack) = message.ack {
                            let _ = ack.send(());
                        }
                    }
                    Err(mpsc::TryRecvError::Disconnected) => return,
                    Err(mpsc::TryRecvError::Empty) => {
                        match events.recv_timeout(Duration::from_millis(2)) {
                            Ok(value) => write(value, &mut stdout),
                            Err(mpsc::RecvTimeoutError::Disconnected) => return,
                            _ => {}
                        }
                    }
                }
            }
        });
        Self {
            control,
            data,
            pending,
            control_frames,
        }
    }
    fn control(&self, values: Vec<Value>, drain: bool, ack: Option<mpsc::SyncSender<()>>) {
        use std::sync::atomic::Ordering;
        if self
            .control_frames
            .try_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                n.checked_add(values.len()).filter(|sum| *sum <= 64)
            })
            .is_err()
        {
            std::process::exit(1);
        }
        if self
            .control
            .try_send(Control { values, drain, ack })
            .is_err()
        {
            std::process::exit(1);
        }
    }
    pub fn admit(&self, id: &str) -> bool {
        let mut pending = self.pending.lock().unwrap();
        if pending.len() >= 32 {
            return false;
        }
        pending.insert(id.to_owned());
        true
    }
    pub fn reply(&self, value: Value) {
        self.control(vec![value], false, None);
    }
    pub fn flush(&self, value: Value) {
        let (s, r) = mpsc::sync_channel(1);
        self.control(vec![value], true, Some(s));
        if r.recv_timeout(Duration::from_secs(1)).is_err() {
            std::process::exit(1);
        }
    }
}
enum Command {
    Write(String, [u8; 32]),
    Close(Option<String>),
}
struct SessionControl {
    send: mpsc::SyncSender<Command>,
    closing: bool,
}
struct State {
    refs: HashMap<String, Endpoint>,
    generation: u64,
    next: u64,
    sessions: HashMap<String, SessionControl>,
    closed: VecDeque<(String, u64)>,
    listing: bool,
}
#[derive(Clone)]
pub struct Transport {
    backend: Arc<dyn Backend>,
    state: Arc<Mutex<State>>,
    output: Output,
    origin: Instant,
    nonce: String,
}
impl Transport {
    pub fn new(backend: Arc<dyn Backend>, output: Output) -> Self {
        let mut bytes = [0u8; 16];
        if getrandom::fill(&mut bytes).is_err() {
            std::process::exit(1);
        }
        let nonce = bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        Self {
            nonce,
            backend,
            output,
            state: Arc::new(Mutex::new(State {
                refs: HashMap::new(),
                generation: 0,
                next: 0,
                sessions: HashMap::new(),
                closed: VecDeque::new(),
                listing: false,
            })),
            origin: Instant::now(),
        }
    }
    pub fn handle(&self, id: String, method: &str, params: &Value) {
        match method {
            #[cfg(feature = "synthetic-hid")]
            "test.stats" => self.output.reply(ok(&id, self.backend.test_stats())),
            "list" => {
                if params.as_object().is_none_or(|p| p.len() != 1) || params["transport"] != "hid" {
                    self.output.reply(fail(&id, "unsupported", "none"));
                    return;
                }
                let mut state = self.state.lock().unwrap();
                if state.listing {
                    self.output.reply(fail(&id, "busy", "none"));
                    return;
                }
                state.listing = true;
                state.refs.clear();
                state.generation += 1;
                drop(state);
                let this = self.clone();
                std::thread::spawn(move || {
                    let result = this.backend.list();
                    let mut state = this.state.lock().unwrap();
                    state.listing = false;
                    match result {
                        Ok(endpoints) if endpoints.len() <= 256 => {
                            let mut devices = Vec::new();
                            for (index, endpoint) in endpoints.into_iter().enumerate() {
                                let reference =
                                    format!("d{}-{}-{index}", this.nonce, state.generation);
                                devices.push(endpoint.record(&reference));
                                state.refs.insert(reference, endpoint);
                            }
                            this.output.reply(ok(&id, json!({"devices":devices})));
                        }
                        Ok(_) => this.output.reply(fail(&id, "capacity", "none")),
                        Err(code) => this.output.reply(fail(&id, code, "none")),
                    }
                });
            }
            "hid.open" | "hid.write" => {
                let one_shot = method == "hid.write";
                let bytes = if one_shot {
                    match payload(params) {
                        Some(v) => Some(v),
                        None => {
                            self.output.reply(fail(&id, "invalid_request", "none"));
                            return;
                        }
                    }
                } else {
                    None
                };
                if params
                    .as_object()
                    .is_none_or(|p| p.len() != if one_shot { 3 } else { 1 })
                {
                    self.output.reply(fail(&id, "invalid_request", "none"));
                    return;
                }
                let mut state = self.state.lock().unwrap();
                if state.sessions.len() >= 8 {
                    self.output.reply(fail(&id, "capacity", "none"));
                    return;
                }
                let Some(reference) = params["deviceRef"]
                    .as_str()
                    .filter(|v| !v.is_empty() && v.len() <= 128)
                else {
                    self.output.reply(fail(&id, "invalid_request", "none"));
                    return;
                };
                let Some(endpoint) = state.refs.get(reference).cloned() else {
                    self.output.reply(fail(&id, "stale_device", "none"));
                    return;
                };
                state.next += 1;
                let session = format!("s{}-{}", self.nonce, state.next);
                let (send, receive) = mpsc::sync_channel(32);
                state.sessions.insert(
                    session.clone(),
                    SessionControl {
                        send,
                        closing: false,
                    },
                );
                drop(state);
                let this = self.clone();
                std::thread::spawn(move || {
                    this.owner(id, session, endpoint, bytes, receive);
                });
            }
            "session.write" | "session.close" => {
                let Some(session) = params["sessionId"]
                    .as_str()
                    .filter(|v| !v.is_empty() && v.len() <= 128)
                else {
                    self.output.reply(fail(&id, "invalid_request", "none"));
                    return;
                };
                let close = method == "session.close";
                if params
                    .as_object()
                    .is_none_or(|p| p.len() != if close { 1 } else { 3 })
                {
                    self.output.reply(fail(&id, "invalid_request", "none"));
                    return;
                }
                let command = if close {
                    Command::Close(Some(id.clone()))
                } else {
                    match payload(params) {
                        Some(bytes) => Command::Write(id.clone(), bytes),
                        None => {
                            self.output.reply(fail(&id, "invalid_request", "none"));
                            return;
                        }
                    }
                };
                let mut state = self.state.lock().unwrap();
                if let Some(control) = state.sessions.get_mut(session) {
                    if !close && control.closing {
                        self.output.reply(fail(&id, "invalid_session", "none"));
                        return;
                    }
                    if control.send.try_send(command).is_err() {
                        self.output.reply(fail(&id, "capacity", "none"));
                    } else if close {
                        control.closing = true;
                    }
                } else if close
                    && let Some((_, seq)) = state.closed.iter().find(|(s, _)| s == session)
                {
                    self.output.reply(ok(&id, json!({"finalSeq":seq})));
                } else {
                    self.output.reply(fail(&id, "invalid_session", "none"));
                }
            }
            _ => self.output.reply(fail(&id, "unsupported", "none")),
        }
    }
    fn owner(
        &self,
        id: String,
        session: String,
        endpoint: Endpoint,
        one_shot: Option<[u8; 32]>,
        commands: mpsc::Receiver<Command>,
    ) {
        let opened = (|| {
            let lease = lease(&endpoint.key)?;
            let current = self.backend.list()?;
            if !current.contains(&endpoint) {
                return Err("stale_device");
            }
            let device = self.backend.open(&endpoint)?;
            Ok((lease, device))
        })();
        let (lease, mut device) = match opened {
            Ok(v) => v,
            Err(code) => {
                self.state.lock().unwrap().sessions.remove(&session);
                self.output.reply(fail(&id, code, "none"));
                return;
            }
        };
        if let Some(bytes) = one_shot {
            let result = device.write(&bytes);
            if device.close().is_err() {
                std::process::exit(1);
            }
            drop(device);
            drop(lease);
            self.state.lock().unwrap().sessions.remove(&session);
            self.output.reply(match result {
                Ok(()) => ok(&id, json!({"acceptedBytes":32})),
                Err(code) => fail(&id, code, "possible"),
            });
            return;
        }
        // Acknowledgement from writer establishes open response before the first event.
        let (send, receive) = mpsc::sync_channel(1);
        self.output.control(
            vec![ok(&id, json!({"sessionId":session}))],
            false,
            Some(send),
        );
        if receive.recv_timeout(Duration::from_secs(2)).is_err() {
            std::process::exit(1);
        }
        let mut seq = 0;
        let mut closing = None;
        let mut failure = None;
        loop {
            match commands.try_recv() {
                Ok(Command::Close(id)) => {
                    closing = id;
                    break;
                }
                Ok(Command::Write(id, bytes)) => match device.write(&bytes) {
                    Ok(()) => self.output.reply(ok(&id, json!({"acceptedBytes":32}))),
                    Err(code) => {
                        self.output.reply(fail(&id, code, "possible"));
                        failure = Some(code);
                        break;
                    }
                },
                Err(mpsc::TryRecvError::Disconnected) => break,
                _ => {}
            }
            match device.read() {
                Ok(Some(bytes)) => {
                    let value = json!({"v":1,"type":"event","sessionId":session,"seq":seq+1,"event":"data","receivedAtUs":self.origin.elapsed().as_micros().to_string(),"bytes":STANDARD.encode(bytes)});
                    if self.output.data.try_send(value).is_err() {
                        failure = Some("overflow");
                        break;
                    }
                    seq += 1;
                }
                Ok(None) => {}
                Err(code) => {
                    failure = Some(code);
                    break;
                }
            }
        }
        if failure.is_none() {
            loop {
                match device.pending() {
                    Ok(Some(bytes)) => {
                        let value = json!({"v":1,"type":"event","sessionId":session,"seq":seq+1,"event":"data","receivedAtUs":self.origin.elapsed().as_micros().to_string(),"bytes":STANDARD.encode(bytes)});
                        if self.output.data.try_send(value).is_err() {
                            failure = Some("overflow");
                            break;
                        }
                        seq += 1;
                    }
                    Ok(None) => break,
                    Err(code) => {
                        failure = Some(code);
                        break;
                    }
                }
            }
        }
        // A failed native close cannot publish release or drop the lease first. Exit reaps
        // the entire owner task; parent EOF marks every outstanding effect/loss unknown.
        if device.close().is_err() {
            std::process::exit(1);
        }
        // Drop the native handle BEFORE releasing the lease or publishing closed.
        drop(device);
        drop(lease);
        let mut terminal = Vec::new();
        if let Some(code) = failure {
            seq += 1;
            terminal.push(json!({"v":1,"type":"event","sessionId":session,"seq":seq,"event":"failed","error":error(code,"none"),"loss":if code=="overflow" {"detected"}else{"unknown"}}));
        }
        seq += 1;
        terminal.push(json!({"v":1,"type":"event","sessionId":session,"seq":seq,"event":"closed","reason":if failure.is_some(){"failed"}else{"requested"}}));
        let mut state = self.state.lock().unwrap();
        state.sessions.remove(&session);
        state.closed.push_back((session.clone(), seq));
        if state.closed.len() > 256 {
            state.closed.pop_front();
        }
        if let Some(id) = closing {
            terminal.push(ok(&id, json!({"finalSeq":seq})));
        }
        // Fail all commands admitted before the closing state became visible, never replay them.
        for command in commands.try_iter() {
            match command {
                Command::Close(Some(id)) => terminal.push(ok(&id, json!({"finalSeq":seq}))),
                Command::Close(None) => {}
                Command::Write(id, _) => terminal.push(fail(&id, "invalid_session", "none")),
            }
        }
        self.output.control(terminal, true, None);
        drop(state);
    }
    pub fn shutdown(&self) -> bool {
        {
            let mut state = self.state.lock().unwrap();
            for control in state.sessions.values_mut() {
                control.closing = true;
                if control.send.try_send(Command::Close(None)).is_err() {
                    return false;
                }
            }
        }
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(1) {
            let state = self.state.lock().unwrap();
            if state.sessions.is_empty() && !state.listing {
                return true;
            }
            drop(state);
            std::thread::sleep(Duration::from_millis(2));
        }
        false
    }
}
fn payload(params: &Value) -> Option<[u8; 32]> {
    if params["reportId"].as_u64() != Some(0) {
        return None;
    }
    let text = params["bytes"].as_str()?;
    if text.len() != 44 {
        return None;
    }
    let bytes = STANDARD.decode(text).ok()?;
    if STANDARD.encode(&bytes) != text {
        return None;
    }
    bytes.try_into().ok()
}

#[cfg(unix)]
fn lease(key: &str) -> Result<std::fs::File, &'static str> {
    use std::os::unix::{
        fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
        io::AsRawFd,
    };
    unsafe extern "C" {
        fn getuid() -> u32;
        fn flock(fd: i32, operation: i32) -> i32;
    }
    let uid = unsafe { getuid() };
    let root = std::env::temp_dir().join(format!("keyloom-device-leases-{uid}"));
    match std::fs::DirBuilder::new().mode(0o700).create(&root) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("permission_denied"),
    }
    let metadata = std::fs::symlink_metadata(&root).map_err(|_| "permission_denied")?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return Err("permission_denied");
    }
    let mut hash = 0xcbf29ce484222325u64;
    for byte in key.bytes() {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
    }
    #[cfg(target_os = "macos")]
    let nofollow = 0x100;
    #[cfg(not(target_os = "macos"))]
    let nofollow = 0x20000;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(nofollow)
        .open(root.join(format!("{hash:016x}")))
        .map_err(|_| "permission_denied")?;
    let metadata = file.metadata().map_err(|_| "permission_denied")?;
    if !metadata.is_file() || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
        return Err("permission_denied");
    }
    if unsafe { flock(file.as_raw_fd(), 2 | 4) } != 0 {
        return Err("busy");
    }
    Ok(file)
}
// Windows production is unavailable; this lock exercises only the compiled synthetic backend.
#[cfg(all(not(unix), feature = "synthetic-hid"))]
fn lease(_key: &str) -> Result<std::fs::File, &'static str> {
    let root = std::env::temp_dir().join("keyloom-synthetic-hid-lease");
    std::fs::create_dir_all(&root).map_err(|_| "permission_denied")?;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("endpoint"))
        .map_err(|_| "permission_denied")?;
    file.try_lock().map_err(|_| "busy")?;
    Ok(file)
}
#[cfg(all(not(unix), not(feature = "synthetic-hid")))]
fn lease(_key: &str) -> Result<std::fs::File, &'static str> {
    Err("unsupported")
}
