// Starts the bundled `keyloom serve`, or finds the one already serving this data directory (D-323). All the deciding is the CLI's:
// the shell passes flags and reads the URL line, so there is no product logic here.
use crate::{AppState, Server};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

// What this shell depends on from `keyloom serve`, as one integer: the flags below, the stderr marker lines, the `menuBar` object in
// /api/events frames, POST /api/sync and the x-keyloom-token header. It is passed as `--client-protocol`, and the CLI refuses to start,
// or to attach to a server, that speaks another (D-454). It must equal DESKTOP_PROTOCOL in src/api/desktop-protocol.ts, which says when
// to bump it; test/api/desktop-protocol.test.ts fails if the two differ.
const DESKTOP_PROTOCOL: u32 = 1;

/// `Reuse` attaches to a keyloom already serving the data directory; `Replace` (only after the person asks) stops it and serves from the bundled one.
#[derive(Clone, Copy, PartialEq)]
pub enum Mode {
    Reuse,
    Replace,
}

// Generic over the child only so the tests can hold one without a Tauri app.
pub struct Running<C = CommandChild> {
    child: C,
    exited: std::sync::mpsc::Receiver<()>,
}

// The page keeps its theme and dismissed tips in localStorage, which is per origin and the port is part of the origin, so the
// last port is asked for again. `serve --port 0` picks a free one when it is taken (D-321), and that one is remembered instead.
fn port_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("port"))
}

fn remembered_port(app: &AppHandle) -> u16 {
    port_file(app).and_then(|f| std::fs::read_to_string(f).ok()).and_then(|t| t.trim().parse().ok()).unwrap_or(0)
}

fn remember_port(app: &AppHandle, port: u16) {
    if let Some(f) = port_file(app) {
        let _ = std::fs::create_dir_all(f.parent().expect("a file path has a parent"));
        let _ = std::fs::write(f, port.to_string());
    }
}

pub async fn start(app: &AppHandle, mode: Mode) -> Result<Server, Failure> {
    let wanted = remembered_port(app);
    let env = tauri::async_runtime::spawn_blocking(crate::login_path::resolve).await.map_err(|e| Failure::Other(e.to_string()))?;
    match launch(app, wanted, &env, mode).await {
        // `serve` refuses a port that is in use; any other free port will do.
        Err(Failure::PortInUse) if wanted != 0 => launch(app, 0, &env, mode).await,
        other => other,
    }
}

#[derive(Clone, Debug)]
pub enum Failure {
    PortInUse,
    /// Another keyloom is serving the data directory and can't be used. `words` are the CLI's; `replace` is the CLI's label for replacing it, when it offers that.
    Incompatible { words: String, replace: Option<String> },
    /// The server printed no URL within URL_WAIT_SECS.
    TimedOut,
    /// The server exited before it printed its URL; `output` is what it wrote to stderr.
    Exited { code: Option<i32>, output: String },
    /// The sidecar could not be run, or printed something the shell can't read.
    Other(String),
}

// The CLI prints these two lines (src/cli/serve-existing.ts) and exits 10; the shell shows them and decides nothing.
// How long the shell waits for the sidecar's URL. Every `serve` mode may wait for the directory lock, or for a server that is finishing a
// keyboard write, before it prints one, all inside one 120 s budget (TAKEOVER_TIMEOUT_MS in src/server/replace-server.ts). This is tied to
// it: keep this longer than that, and change them together. A shorter wait gives up on a launch that was only queued behind another app.
const URL_WAIT_SECS: u64 = 135;
// TAKEOVER_TIMEOUT_MS is 120_000 in src/server/replace-server.ts; test/api/desktop-protocol.test.ts checks this pair too.
const _: () = assert!(URL_WAIT_SECS > 120, "the shell must wait longer than the CLI's 120 s takeover budget");

const CANNOT_ATTACH: &str = "keyloom cannot attach: ";
const CAN_REPLACE: &str = "keyloom can replace it: ";

fn parse_incompatible(stderr: &str) -> Option<(String, Option<String>)> {
    let line_after = |marker: &str| stderr.lines().find_map(|l| l.strip_prefix(marker)).map(|r| r.trim().to_string());
    let words = line_after(CANNOT_ATTACH)?;
    Some((words, line_after(CAN_REPLACE)))
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Failure::PortInUse => write!(f, "the port keyloom asked for is in use"),
            Failure::Incompatible { words, .. } => write!(f, "{words}"),
            Failure::TimedOut => write!(f, "timed out waiting for keyloom to print its URL"),
            // The output goes to the log once, through log::server_output, which drops the line that carries the token.
            Failure::Exited { code, .. } => write!(f, "keyloom exited early ({code:?})"),
            Failure::Other(m) => write!(f, "{m}"),
        }
    }
}

async fn launch(app: &AppHandle, port: u16, env: &crate::login_path::LoginEnvironment, mode: Mode) -> Result<Server, Failure> {
    let other = |e: &dyn std::fmt::Display| Failure::Other(e.to_string());
    let (mut rx, child) = app
        .shell()
        .sidecar("keyloom")
        .map_err(|e| other(&e))?
        // --reuse: a server already on this data directory (BK's browser one) is attached to, not doubled (it would run a second sync engine),
        // unless it can't work with this app (--client-protocol); --replace is what the person chose when the CLI offered to stop it.
        // --exit-on-stdin-close: the pipe the shell holds closes when the shell dies, however it dies.
        .args(["serve", "--port", &port.to_string(), "--no-open", "--exit-on-stdin-close", if mode == Mode::Replace { "--replace" } else { "--reuse" }, "--client-protocol", &DESKTOP_PROTOCOL.to_string()])
        // So codex, docker and zapp are found where the person's terminal finds them (D-441), and chat gets the provider
        // settings the shell exports (D-443). Values are never logged.
        .env("PATH", &env.path)
        .envs(env.variables.iter().map(|(name, value)| (name.as_str(), value.as_str())))
        .spawn()
        .map_err(|e| other(&e))?;

    let (exit_tx, exited) = std::sync::mpsc::channel();
    let pid = child.pid();
    let mut child = Some(child);
    let mut stderr = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(URL_WAIT_SECS);
    loop {
        let event = within(deadline, pid, rx.recv()).await?;
        match event {
            Some(CommandEvent::Stderr(line)) => {
                let text = String::from_utf8_lossy(&line).to_string();
                stderr.push_str(&text);
                let found = ["keyloom is running at ", "keyloom is already running at "].iter().find_map(|marker| {
                    text.split(marker).nth(1).and_then(|r| r.lines().next()).map(|url| (url.trim().to_string(), *marker == "keyloom is running at "))
                });
                let Some((url, owned)) = found else { continue };
                // A URL line the shell can't use leaves no way to reach the server it started, so that server is stopped, not left running.
                let read = url::Url::parse(&url).map_err(|e| other(&e)).and_then(|parsed| {
                    let token = parsed.query_pairs().find(|(k, _)| k == "t").map(|(_, v)| v.into_owned()).ok_or_else(|| Failure::Other("no token in URL".into()))?;
                    Ok((parsed, token))
                });
                let (parsed, token) = match read {
                    Ok(read) => read,
                    Err(failure) => {
                        if owned {
                            terminate(pid);
                        }
                        return Err(failure);
                    }
                };
                let origin = format!("{}://{}:{}", parsed.scheme(), parsed.host_str().unwrap_or("127.0.0.1"), parsed.port().unwrap_or(80));
                // A new server's tail starts empty, owned or not, so a later window never shows an earlier server's last lines.
                app.state::<AppState>().server_tail.lock().unwrap().clear();
                if owned {
                    remember_port(app, parsed.port().unwrap_or(0));
                    crate::log::say(app, "keyloom's server started");
                    // Keep draining so the pipe never fills, into the log so Show log can say why it stopped; report an exit so quit
                    // can wait for it and the watcher can start it again.
                    let log_app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        while let Some(ev) = rx.recv().await {
                            match ev {
                                CommandEvent::Stderr(line) => {
                                    let text = String::from_utf8_lossy(&line);
                                    crate::log::server_output(&log_app, &text);
                                    keep_tail(&mut log_app.state::<AppState>().server_tail.lock().unwrap(), &text);
                                }
                                CommandEvent::Terminated(p) => {
                                    crate::log::say(&log_app, &format!("keyloom's server exited (code {:?}, signal {:?})", p.code, p.signal));
                                    let _ = exit_tx.send(());
                                    break;
                                }
                                _ => {}
                            }
                        }
                    });
                    let running = Running { child: child.take().expect("spawned above"), exited };
                    let state = app.state::<AppState>();
                    if adopt(&state.sidecar, &state.quit, running).is_err() {
                        // The app began quitting while this server started, and stop() has already looked: stop it here instead.
                        terminate(pid);
                        return Err(Failure::Other("keyloom is quitting".into()));
                    }
                }
                return Ok(Server { url, origin, token, owned });
            }
            Some(CommandEvent::Terminated(p)) => {
                crate::log::server_output(app, &stderr);
                return Err(if let Some((words, replace)) = parse_incompatible(&stderr) {
                    Failure::Incompatible { words, replace }
                } else if stderr.contains("is in use") {
                    Failure::PortInUse
                } else {
                    Failure::Exited { code: p.code, output: stderr }
                });
            }
            Some(_) => {}
            None => return Err(Failure::Other("keyloom closed its output".into())),
        }
    }
}

// Waits for the sidecar's next event until the deadline. A launch that runs out of time stops the server it started: the plugin's
// CommandChild has no kill on drop, and the CLI only watches its stdin once it serves, so a dropped child would keep running and
// Try again would start a second one beside it.
async fn within<T>(deadline: tokio::time::Instant, pid: u32, next: impl std::future::Future<Output = T>) -> Result<T, Failure> {
    tokio::time::timeout_at(deadline, next).await.map_err(|_| {
        terminate(pid);
        Failure::TimedOut
    })
}

// SIGTERM, not the plugin's kill(): the server finishes a keyboard write that is in progress before it exits
// (src/cli/main.ts), and a SIGKILL mid-flash is the one outcome the app must avoid. Only for a child that has not been reaped yet:
// after that its PID may belong to another process.
fn terminate(pid: u32) {
    unsafe { libc::kill(pid as i32, libc::SIGTERM) };
}

// Records the server this shell started, unless the app began quitting. Under the lock stop() takes, so either stop() sees the
// server, or this sees the quit and hands the server back to be stopped.
fn adopt<C>(slot: &std::sync::Mutex<Option<Running<C>>>, quit: &crate::restarts::Quit, running: Running<C>) -> Result<(), Running<C>> {
    let mut slot = slot.lock().unwrap();
    if quit.is_set() {
        return Err(running);
    }
    *slot = Some(running);
    Ok(())
}

// Enough of the server's last words to see why it stopped, held in memory; the whole output is in the log.
const TAIL_LINES: usize = 12;

// Keeps the last TAIL_LINES lines the server wrote, without blank lines or any that carry its session token.
fn keep_tail(tail: &mut std::collections::VecDeque<String>, text: &str) {
    for line in text.lines().filter(|l| !l.trim().is_empty() && !crate::log::carries_token(l)) {
        if tail.len() == TAIL_LINES {
            tail.pop_front();
        }
        tail.push_back(line.to_string());
    }
}

/// What the last server this shell started wrote before it stopped, one line per line.
pub fn last_output(app: &AppHandle) -> String {
    app.state::<AppState>().server_tail.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n")
}

// A server the shell did not start is left running.
pub fn stop(app: &AppHandle) {
    let state = app.state::<AppState>();
    // Set first, so the watcher doesn't start the server again while it is being stopped.
    state.quit.begin();
    let running = state.sidecar.lock().unwrap().take();
    if let Some(running) = running {
        terminate(running.child.pid());
        if running.exited.recv_timeout(std::time::Duration::from_secs(30)).is_err() {
            let _ = running.child.kill();
        }
    }
}

/// True when the server this shell started has exited (or none is recorded), so the watcher may start it again.
pub fn exited(app: &AppHandle) -> bool {
    take_if_exited(&mut app.state::<AppState>().sidecar.lock().unwrap())
}

// An exited server is dropped from the state here. Kept, it would sit there through a failed restart or the hours of a
// keeps-stopping window, and stop() on Quit would SIGTERM its PID, which the system may by then have given to another process.
fn take_if_exited<C>(slot: &mut Option<Running<C>>) -> bool {
    // The drain task sends once and then drops its sender, so a later look sees Disconnected.
    let gone = slot.as_ref().is_none_or(|running| matches!(running.exited.try_recv(), Ok(()) | Err(std::sync::mpsc::TryRecvError::Disconnected)));
    if gone {
        *slot = None;
    }
    gone
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tail_keeps_the_last_lines_and_never_the_token() {
        let mut tail = std::collections::VecDeque::new();
        keep_tail(&mut tail, "keyloom is running at http://127.0.0.1:4477/?t=secret\n\n");
        assert!(tail.is_empty());
        for n in 1..=20 {
            keep_tail(&mut tail, &format!("line {n}\n"));
        }
        assert_eq!(tail.len(), TAIL_LINES);
        assert_eq!(tail.front().map(String::as_str), Some("line 9"));
        assert_eq!(tail.back().map(String::as_str), Some("line 20"));
    }

    #[test]
    fn reads_the_words_and_the_replace_label_from_the_cli() {
        let stderr = "keyloom cannot attach: /d is already being served by keyloom 0.56.0, older than this 0.57.0.\nkeyloom can replace it: Use this app's keyloom\nerror: {\"x\":1}\n";
        let (words, replace) = parse_incompatible(stderr).expect("incompatible");
        assert_eq!(words, "/d is already being served by keyloom 0.56.0, older than this 0.57.0.");
        assert_eq!(replace.as_deref(), Some("Use this app's keyloom"));
    }

    #[test]
    fn a_newer_server_has_words_and_no_replace() {
        let (words, replace) = parse_incompatible("keyloom cannot attach: newer. Update the app.\n").expect("incompatible");
        assert_eq!(words, "newer. Update the app.");
        assert!(replace.is_none());
    }

    #[test]
    fn other_output_is_not_an_incompatible_server() {
        assert!(parse_incompatible("keyloom is already running at http://127.0.0.1:1/?t=x\n").is_none());
        assert!(parse_incompatible("error: port 4477 is in use; pass --port\n").is_none());
        // A marker has to start the line: the CLI's own error text may quote it.
        assert!(parse_incompatible("error: \"keyloom cannot attach: x\"\n").is_none());
    }

    #[test]
    fn an_early_exit_logs_its_code_and_not_the_output_that_may_carry_the_token() {
        let f = Failure::Exited { code: Some(1), output: "keyloom is already running at http://127.0.0.1:1/?t=secret\n".into() };
        assert_eq!(f.to_string(), "keyloom exited early (Some(1))");
    }

    fn running() -> (Running<()>, std::sync::mpsc::Sender<()>) {
        let (tx, exited) = std::sync::mpsc::channel();
        (Running { child: (), exited }, tx)
    }

    #[test]
    fn an_exited_server_is_taken_out_of_the_state_so_quit_never_signals_its_pid() {
        let (r, tx) = running();
        let mut slot = Some(r);
        assert!(!take_if_exited(&mut slot), "still running");
        assert!(slot.is_some());
        tx.send(()).unwrap();
        assert!(take_if_exited(&mut slot));
        assert!(slot.is_none(), "stop() finds nothing to signal");
        assert!(take_if_exited(&mut slot));
    }

    #[test]
    fn a_drain_task_that_ended_without_a_word_counts_as_exited() {
        let (r, tx) = running();
        drop(tx);
        let mut slot = Some(r);
        assert!(take_if_exited(&mut slot));
        assert!(slot.is_none());
    }

    #[test]
    fn a_server_that_starts_after_quit_began_is_handed_back_to_be_stopped() {
        let quit = crate::restarts::Quit::default();
        let slot = std::sync::Mutex::new(None);
        assert!(adopt(&slot, &quit, running().0).is_ok());
        assert!(slot.lock().unwrap().is_some());
        let slot = std::sync::Mutex::new(None);
        quit.begin();
        assert!(adopt(&slot, &quit, running().0).is_err());
        assert!(slot.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn a_launch_that_times_out_stops_the_server_it_started() {
        use std::os::unix::process::ExitStatusExt;
        let mut child = std::process::Command::new("/bin/sleep").arg("30").spawn().expect("sleep runs");
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(50);
        let waited = within(deadline, child.id(), std::future::pending::<()>()).await;
        assert!(matches!(waited, Err(Failure::TimedOut)));
        // SIGTERM, so a server mid keyboard write finishes it first; a SIGKILL would show as signal 9.
        assert_eq!(child.wait().expect("it ends").signal(), Some(libc::SIGTERM));
    }

    #[tokio::test]
    async fn an_event_before_the_deadline_leaves_the_server_running() {
        let mut child = std::process::Command::new("/bin/sleep").arg("30").spawn().expect("sleep runs");
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        assert_eq!(within(deadline, child.id(), async { 7 }).await.ok(), Some(7));
        assert!(child.try_wait().expect("readable").is_none(), "not signalled");
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn an_incompatible_server_displays_the_cli_words() {
        let f = Failure::Incompatible { words: "old".into(), replace: None };
        assert_eq!(f.to_string(), "old");
    }
}
