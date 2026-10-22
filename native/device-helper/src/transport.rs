use crate::connection::{ConnectionBackend, ConnectionEndpoint};
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
fn list_reply(id: &str, devices: Vec<Value>) -> Result<Value, &'static str> {
    let reply = ok(id, json!({"devices":devices}));
    let size = serde_json::to_vec(&reply)
        .map_err(|_| "protocol_error")?
        .len()
        + 1;
    if size > crate::MAX_FRAME {
        return Err("capacity");
    }
    Ok(reply)
}
struct Control {
    values: Vec<Value>,
    drain: bool,
    ack: Option<mpsc::SyncSender<()>>,
}
struct QueuedData {
    value: Value,
    serial: bool,
}
#[derive(Clone)]
pub struct Output {
    control: mpsc::SyncSender<Control>,
    data: mpsc::SyncSender<QueuedData>,
    serial_queued: Arc<std::sync::atomic::AtomicUsize>,
    pending: Arc<Mutex<HashSet<String>>>,
    control_frames: Arc<std::sync::atomic::AtomicUsize>,
}
impl Output {
    pub fn start() -> Self {
        let (control, controls) = mpsc::sync_channel::<Control>(64);
        let (data, events) = mpsc::sync_channel::<QueuedData>(510);
        let serial_queued = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let serial_pending = serial_queued.clone();
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
            let data_write = |item: QueuedData, stdout: &mut std::io::StdoutLock<'_>| {
                if item.serial {
                    serial_pending.fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
                }
                write(item.value, stdout);
            };
            loop {
                match controls.try_recv() {
                    Ok(message) => {
                        if message.drain {
                            for value in events.try_iter().take(1024) {
                                data_write(value, &mut stdout);
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
                            Ok(value) => data_write(value, &mut stdout),
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
            serial_queued,
            pending,
            control_frames,
        }
    }
    fn data(&self, value: Value, transport: &str) -> Result<(), ()> {
        use std::sync::atomic::Ordering;
        let serial = transport == "serial";
        if serial
            && self
                .serial_queued
                .try_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                    (n < 16).then_some(n + 1)
                })
                .is_err()
        {
            return Err(());
        }
        if self.data.try_send(QueuedData { value, serial }).is_err() {
            if serial {
                self.serial_queued.fetch_sub(1, Ordering::AcqRel);
            }
            return Err(());
        }
        Ok(())
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
    Write(String, Vec<u8>),
    Close(Option<String>),
}
struct SessionControl {
    send: mpsc::SyncSender<Command>,
    closing: bool,
    transport: &'static str,
}
struct State {
    refs: HashMap<String, ConnectionEndpoint>,
    generation: HashMap<String, u64>,
    next: u64,
    sessions: HashMap<String, SessionControl>,
    closed: VecDeque<(String, u64)>,
    listing: HashSet<String>,
}
impl State {
    fn invalidate_refs(&mut self, transport: &str) {
        self.refs
            .retain(|_, endpoint| endpoint.transport() != transport);
    }
    /// Replaces one transport's references with a fresh listing. An endpoint whose full snapshot
    /// is unchanged keeps its reference, so another caller's list between this caller's list and
    /// open does not invalidate it (D-433). Changed or vanished endpoints lose theirs; open still
    /// re-checks identity.
    fn relist(
        &mut self,
        transport: &str,
        endpoints: Vec<ConnectionEndpoint>,
        mint: impl Fn(usize) -> String,
    ) -> Vec<(String, ConnectionEndpoint)> {
        let previous: Vec<(String, ConnectionEndpoint)> = self
            .refs
            .iter()
            .filter(|(_, e)| e.transport() == transport)
            .map(|(r, e)| (r.clone(), e.clone()))
            .collect();
        self.invalidate_refs(transport);
        let listed: Vec<(String, ConnectionEndpoint)> = endpoints
            .into_iter()
            .enumerate()
            .map(|(index, endpoint)| {
                let reference = previous
                    .iter()
                    .find(|(_, e)| *e == endpoint)
                    .map_or_else(|| mint(index), |(r, _)| r.clone());
                (reference, endpoint)
            })
            .collect();
        for (reference, endpoint) in &listed {
            self.refs.insert(reference.clone(), endpoint.clone());
        }
        listed
    }
}
#[derive(Clone)]
pub struct Transport {
    backends: Vec<ConnectionBackend>,
    state: Arc<Mutex<State>>,
    output: Output,
    origin: Instant,
    nonce: String,
}
impl Transport {
    pub fn new(backends: Vec<ConnectionBackend>, output: Output) -> Self {
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
            backends,
            output,
            state: Arc::new(Mutex::new(State {
                refs: HashMap::new(),
                generation: HashMap::new(),
                next: 0,
                sessions: HashMap::new(),
                closed: VecDeque::new(),
                listing: HashSet::new(),
            })),
            origin: Instant::now(),
        }
    }
    pub fn handle(&self, id: String, method: &str, params: &Value) {
        match method {
            #[cfg(any(feature = "synthetic-hid", feature = "synthetic-serial"))]
            "test.stats" => {
                let backend = self
                    .backends
                    .iter()
                    .find(|b| params["transport"] == b.transport())
                    .unwrap_or(&self.backends[0]);
                self.output.reply(ok(&id, backend.test_stats()));
            }
            "list" => {
                let Some(backend) = self
                    .backends
                    .iter()
                    .find(|b| params["transport"] == b.transport())
                    .cloned()
                else {
                    self.output.reply(fail(&id, "unsupported", "none"));
                    return;
                };
                if params.as_object().is_none_or(|p| p.len() != 1) {
                    self.output.reply(fail(&id, "invalid_request", "none"));
                    return;
                }
                let mut state = self.state.lock().unwrap();
                if state.listing.contains(backend.transport()) {
                    self.output.reply(fail(&id, "busy", "none"));
                    return;
                }
                let transport = backend.transport();
                state.listing.insert(transport.to_owned());
                *state.generation.entry(transport.to_owned()).or_default() += 1;
                drop(state);
                let this = self.clone();
                std::thread::spawn(move || {
                    let result = backend.list();
                    let mut state = this.state.lock().unwrap();
                    state.listing.remove(backend.transport());
                    match result {
                        Ok(endpoints) if endpoints.len() <= 256 => {
                            let generation = state.generation[backend.transport()];
                            let listed = state.relist(backend.transport(), endpoints, |index| {
                                format!(
                                    "d{}-{}-{generation}-{index}",
                                    this.nonce,
                                    backend.transport()
                                )
                            });
                            let mut devices = Vec::new();
                            for (reference, endpoint) in listed {
                                match endpoint.record(&reference) {
                                    Ok(record) => devices.push(record),
                                    Err(code) => {
                                        state.invalidate_refs(backend.transport());
                                        this.output.reply(fail(&id, code, "none"));
                                        return;
                                    }
                                }
                            }
                            match list_reply(&id, devices) {
                                Ok(reply) => this.output.reply(reply),
                                Err(code) => {
                                    state.invalidate_refs(backend.transport());
                                    this.output.reply(fail(&id, code, "none"));
                                }
                            }
                        }
                        Ok(_) => {
                            state.invalidate_refs(backend.transport());
                            this.output.reply(fail(&id, "capacity", "none"))
                        }
                        Err(code) => {
                            state.invalidate_refs(backend.transport());
                            this.output.reply(fail(&id, code, "none"))
                        }
                    }
                });
            }
            "hid.open" | "hid.write" | "serial.open" | "serial.touch" => {
                let transport = if method.starts_with("serial.") {
                    "serial"
                } else {
                    "hid"
                };
                if !self.backends.iter().any(|b| b.transport() == transport) {
                    self.output.reply(fail(&id, "unsupported", "none"));
                    return;
                }
                let touch = method == "serial.touch";
                let baud = params["baud"].as_u64().filter(|n| matches!(n, 1200 | 1201));
                if touch && baud.is_none() {
                    self.output.reply(fail(&id, "invalid_request", "none"));
                    return;
                }
                let one_shot = method == "hid.write";
                let bytes = if one_shot {
                    match payload(params, "hid") {
                        Some(v) => Some(v),
                        None => {
                            self.output.reply(fail(&id, "invalid_request", "none"));
                            return;
                        }
                    }
                } else {
                    None
                };
                if params.as_object().is_none_or(|p| {
                    p.len()
                        != if one_shot {
                            3
                        } else if touch {
                            2
                        } else {
                            1
                        }
                }) {
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
                if endpoint.transport() != transport {
                    self.output.reply(fail(&id, "stale_device", "none"));
                    return;
                }
                state.next += 1;
                let session = format!("s{}-{}", self.nonce, state.next);
                let (send, receive) = mpsc::sync_channel(32);
                state.sessions.insert(
                    session.clone(),
                    SessionControl {
                        send,
                        closing: false,
                        transport,
                    },
                );
                drop(state);
                let this = self.clone();
                std::thread::spawn(move || {
                    this.owner(
                        id,
                        session,
                        endpoint,
                        bytes,
                        if touch { baud } else { None },
                        receive,
                    );
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
                let mut state = self.state.lock().unwrap();
                let transport = state
                    .sessions
                    .get(session)
                    .map(|c| c.transport)
                    .unwrap_or("hid");
                if params.as_object().is_none_or(|p| {
                    p.len()
                        != if close {
                            1
                        } else if transport == "hid" {
                            3
                        } else {
                            2
                        }
                }) {
                    self.output.reply(fail(&id, "invalid_request", "none"));
                    return;
                }
                let command = if close {
                    Command::Close(Some(id.clone()))
                } else {
                    match payload(params, transport) {
                        Some(bytes) => Command::Write(id.clone(), bytes),
                        None => {
                            self.output.reply(fail(&id, "invalid_request", "none"));
                            return;
                        }
                    }
                };
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
        endpoint: ConnectionEndpoint,
        one_shot: Option<Vec<u8>>,
        touch: Option<u64>,
        commands: mpsc::Receiver<Command>,
    ) {
        let backend = self
            .backends
            .iter()
            .find(|b| b.transport() == endpoint.transport())
            .unwrap();
        let opened = (|| {
            let lease = lease(&endpoint.lease_key())?;
            let current = backend.list()?;
            if !current.contains(&endpoint) {
                return Err(crate::serial::OpenError::from("stale_device"));
            }
            if let Some(baud) = touch {
                backend.touch(&endpoint, baud)?;
                return Ok((lease, None));
            }
            let device = backend.open(&endpoint)?;
            Ok((lease, Some(device)))
        })();
        let (lease, mut device) = match opened {
            Ok(v) => v,
            Err(code) => {
                self.state.lock().unwrap().sessions.remove(&session);
                self.output.reply(fail(
                    &id,
                    code.code,
                    if code.possible { "possible" } else { "none" },
                ));
                return;
            }
        };
        let Some(mut device) = device.take() else {
            drop(lease);
            self.state.lock().unwrap().sessions.remove(&session);
            self.output.reply(ok(&id, json!({"lineStateApplied":true})));
            return;
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
                    Ok(()) => self
                        .output
                        .reply(ok(&id, json!({"acceptedBytes":bytes.len()}))),
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
                    if !endpoint.valid_chunk(&bytes) {
                        failure = Some("protocol_error");
                        break;
                    }
                    let value = json!({"v":1,"type":"event","sessionId":session,"seq":seq+1,"event":"data","receivedAtUs":self.origin.elapsed().as_micros().to_string(),"bytes":STANDARD.encode(bytes)});
                    if self.output.data(value, endpoint.transport()).is_err() {
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
                        if !endpoint.valid_chunk(&bytes) {
                            failure = Some("protocol_error");
                            break;
                        }
                        let value = json!({"v":1,"type":"event","sessionId":session,"seq":seq+1,"event":"data","receivedAtUs":self.origin.elapsed().as_micros().to_string(),"bytes":STANDARD.encode(bytes)});
                        if self.output.data(value, endpoint.transport()).is_err() {
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
            if state.sessions.is_empty() && state.listing.is_empty() {
                return true;
            }
            drop(state);
            std::thread::sleep(Duration::from_millis(2));
        }
        false
    }
}
fn payload(params: &Value, transport: &str) -> Option<Vec<u8>> {
    if transport == "hid" && params["reportId"].as_u64() != Some(0) {
        return None;
    }
    if transport == "serial" && params.get("reportId").is_some() {
        return None;
    }
    let text = params["bytes"].as_str()?;
    if text.len() > 5464 {
        return None;
    }
    let bytes = STANDARD.decode(text).ok()?;
    if bytes.is_empty()
        || bytes.len() > 4096
        || STANDARD.encode(&bytes) != text
        || (transport == "hid" && bytes.len() != 32)
    {
        return None;
    }
    Some(bytes)
}

fn lease_name(key: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in key.bytes() {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
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
        .open(root.join(lease_name(key)))
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
#[cfg(all(
    not(unix),
    any(feature = "synthetic-hid", feature = "synthetic-serial")
))]
fn lease(key: &str) -> Result<std::fs::File, &'static str> {
    let root = std::env::temp_dir().join("keyloom-synthetic-device-leases");
    std::fs::create_dir_all(&root).map_err(|_| "permission_denied")?;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(lease_name(key)))
        .map_err(|_| "permission_denied")?;
    file.try_lock().map_err(|_| "busy")?;
    Ok(file)
}
#[cfg(all(
    not(unix),
    not(any(feature = "synthetic-hid", feature = "synthetic-serial"))
))]
fn lease(_key: &str) -> Result<std::fs::File, &'static str> {
    Err("unsupported")
}

#[cfg(test)]
mod frame_tests {
    use super::*;
    #[test]
    fn open_and_touch_failure_preserve_native_effect_on_the_wire() {
        struct FailedOpen(crate::serial::SerialEndpoint, bool);
        impl crate::serial::SerialBackend for FailedOpen {
            fn list(&self) -> Result<Vec<crate::serial::SerialEndpoint>, &'static str> {
                Ok(vec![self.0.clone()])
            }
            fn open(
                &self,
                _: &crate::serial::SerialEndpoint,
            ) -> Result<Box<dyn crate::serial::SerialDevice>, crate::serial::OpenError>
            {
                Err(crate::serial::OpenError {
                    code: "io_failed",
                    possible: self.1,
                })
            }
            fn touch(
                &self,
                _: &crate::serial::SerialEndpoint,
                _: u64,
            ) -> Result<(), crate::serial::OpenError> {
                Err(crate::serial::OpenError {
                    code: "io_failed",
                    possible: self.1,
                })
            }
            #[cfg(any(feature = "synthetic-hid", feature = "synthetic-serial"))]
            fn test_stats(&self) -> Value {
                json!({})
            }
        }
        for (possible, touch) in [
            (false, None),
            (true, None),
            (false, Some(1200)),
            (true, Some(1201)),
        ] {
            let endpoint = crate::serial::SerialEndpoint {
                key: format!("synthetic-owner-error-{}-{possible}", std::process::id()),
                vendor: 1,
                product: 2,
                serial: None,
                product_name: None,
                interface_number: None,
            };
            let (control, replies) = mpsc::sync_channel(64);
            let (data, _events) = mpsc::sync_channel(16);
            let output = Output {
                control,
                data,
                serial_queued: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                pending: Arc::new(Mutex::new(HashSet::new())),
                control_frames: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            };
            let transport = Transport::new(
                vec![ConnectionBackend::Serial(Arc::new(FailedOpen(
                    endpoint.clone(),
                    possible,
                )))],
                output,
            );
            let (_send, commands) = mpsc::sync_channel(1);
            transport.owner(
                "2".into(),
                "s-test".into(),
                ConnectionEndpoint::Serial(endpoint),
                None,
                touch,
                commands,
            );
            let reply = replies.recv_timeout(Duration::from_secs(1)).unwrap();
            assert_eq!(
                reply.values[0]["error"],
                json!({"code":"io_failed", "effect":if possible { "possible" } else { "none" }, "retry":"never"})
            );
            assert!(transport.state.lock().unwrap().sessions.is_empty());
        }
    }
    #[test]
    fn relist_keeps_only_unchanged_endpoints_references() {
        let serial = |key: &str, number: &str| {
            ConnectionEndpoint::Serial(crate::serial::SerialEndpoint {
                key: key.into(),
                vendor: 0x16c0,
                product: 0x27db,
                serial: Some(number.into()),
                product_name: None,
                interface_number: Some(1),
            })
        };
        let hid = ConnectionEndpoint::Hid(crate::backend::Endpoint {
            key: "h".into(),
            vendor: 1,
            product: 2,
            serial: None,
            descriptor: vec![],
        });
        let mut state = State {
            refs: HashMap::from([("hid-ref".into(), hid.clone())]),
            generation: HashMap::new(),
            next: 0,
            sessions: HashMap::new(),
            closed: VecDeque::new(),
            listing: HashSet::new(),
        };
        let first = state.relist(
            "serial",
            vec![
                serial("10:/dev/cu.a", "L"),
                serial("11:/dev/cu.b", "R"),
                serial("12:/dev/cu.c", "X"),
            ],
            |i| format!("g1-{i}"),
        );
        assert_eq!(
            first.iter().map(|(r, _)| r.as_str()).collect::<Vec<_>>(),
            ["g1-0", "g1-1", "g1-2"]
        );
        // a: unchanged; b: same path re-attached under a new registry ID; c: vanished; d: new.
        let second = state.relist(
            "serial",
            vec![
                serial("10:/dev/cu.a", "L"),
                serial("20:/dev/cu.b", "R"),
                serial("13:/dev/cu.d", "Y"),
            ],
            |i| format!("g2-{i}"),
        );
        assert_eq!(
            second.iter().map(|(r, _)| r.as_str()).collect::<Vec<_>>(),
            ["g1-0", "g2-1", "g2-2"]
        );
        assert!(!state.refs.contains_key("g1-1") && !state.refs.contains_key("g1-2"));
        assert_eq!(state.refs.get("hid-ref"), Some(&hid));
        // Same key with different metadata is a changed endpoint, not the same one.
        let third = state.relist("serial", vec![serial("10:/dev/cu.a", "other")], |i| {
            format!("g3-{i}")
        });
        assert_eq!(third[0].0, "g3-0");
        assert_eq!(state.refs.len(), 2);
    }
    #[test]
    fn reference_invalidation_is_scoped_to_one_transport() {
        let hid = ConnectionEndpoint::Hid(crate::backend::Endpoint {
            key: "same".into(),
            vendor: 1,
            product: 2,
            serial: None,
            descriptor: vec![],
        });
        let serial = ConnectionEndpoint::Serial(crate::serial::SerialEndpoint {
            key: "same".into(),
            vendor: 1,
            product: 2,
            serial: None,
            product_name: None,
            interface_number: None,
        });
        assert_ne!(hid.lease_key(), serial.lease_key());
        let mut state = State {
            refs: HashMap::from([("h".into(), hid.clone()), ("s".into(), serial.clone())]),
            generation: HashMap::new(),
            next: 0,
            sessions: HashMap::new(),
            closed: VecDeque::new(),
            listing: HashSet::new(),
        };
        state.invalidate_refs("serial");
        assert_eq!(state.refs, HashMap::from([("h".into(), hid)]));
        state.refs.insert("s".into(), serial.clone());
        state.invalidate_refs("hid");
        assert_eq!(state.refs, HashMap::from([("s".into(), serial)]));
    }
    #[test]
    fn maximum_metadata_cannot_create_an_oversized_wire_frame() {
        let endpoint = crate::backend::Endpoint {
            key: "not-a-path".into(),
            vendor: 0x3297,
            product: 0x1969,
            serial: Some("s".repeat(256)),
            descriptor: vec![],
        };
        let devices = (0..256)
            .map(|index| endpoint.record(&format!("d{}-1-{index}", "n".repeat(32))))
            .collect::<Vec<_>>();
        assert!(
            serde_json::to_vec(&ok("2", json!({"devices":devices})))
                .unwrap()
                .len()
                + 1
                > crate::MAX_FRAME
        );
        assert_eq!(list_reply("2", devices), Err("capacity"));
        assert!(list_reply("2", vec![endpoint.record("d-valid")]).is_ok());
    }
}
