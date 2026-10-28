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

pub struct Running {
    child: CommandChild,
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

pub enum Failure {
    PortInUse,
    /// Another keyloom is serving the data directory and can't be used. `words` are the CLI's; `replace` is the CLI's label for replacing it, when it offers that.
    Incompatible { words: String, replace: Option<String> },
    Other(String),
}

// The CLI prints these two lines (src/cli/serve-existing.ts) and exits 10; the shell shows them and decides nothing.
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
    let mut child = Some(child);
    let mut stderr = String::new();
    // --replace waits for the old server to finish any keyboard write before it starts (up to two minutes, src/server/replace-server.ts).
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(if mode == Mode::Replace { 135 } else { 20 });
    loop {
        let event = tokio::time::timeout_at(deadline, rx.recv()).await.map_err(|_| Failure::Other("timed out waiting for keyloom to print its URL".into()))?;
        match event {
            Some(CommandEvent::Stderr(line)) => {
                let text = String::from_utf8_lossy(&line).to_string();
                stderr.push_str(&text);
                let found = ["keyloom is running at ", "keyloom is already running at "].iter().find_map(|marker| {
                    text.split(marker).nth(1).and_then(|r| r.lines().next()).map(|url| (url.trim().to_string(), *marker == "keyloom is running at "))
                });
                let Some((url, owned)) = found else { continue };
                let parsed = url::Url::parse(&url).map_err(|e| other(&e))?;
                let token = parsed.query_pairs().find(|(k, _)| k == "t").map(|(_, v)| v.into_owned()).ok_or_else(|| Failure::Other("no token in URL".into()))?;
                let origin = format!("{}://{}:{}", parsed.scheme(), parsed.host_str().unwrap_or("127.0.0.1"), parsed.port().unwrap_or(80));
                if owned {
                    remember_port(app, parsed.port().unwrap_or(0));
                    // Keep draining so the pipe never fills; report an exit so quit can wait for it.
                    tauri::async_runtime::spawn(async move {
                        while let Some(ev) = rx.recv().await {
                            if let CommandEvent::Terminated(_) = ev {
                                let _ = exit_tx.send(());
                                break;
                            }
                        }
                    });
                    let running = Running { child: child.take().expect("spawned above"), exited };
                    *app.state::<AppState>().sidecar.lock().unwrap() = Some(running);
                }
                return Ok(Server { url, origin, token, owned });
            }
            Some(CommandEvent::Terminated(p)) => {
                return Err(if let Some((words, replace)) = parse_incompatible(&stderr) {
                    Failure::Incompatible { words, replace }
                } else if stderr.contains("is in use") {
                    Failure::PortInUse
                } else {
                    Failure::Other(format!("keyloom exited early ({:?}): {}", p.code, stderr.trim()))
                });
            }
            Some(_) => {}
            None => return Err(Failure::Other("keyloom closed its output".into())),
        }
    }
}

// SIGTERM, not the plugin's kill(): the server finishes a keyboard write that is in progress before it exits
// (src/cli/main.ts), and a SIGKILL mid-flash is the one outcome the app must avoid. A server the shell did not start is left running.
pub fn stop(app: &AppHandle) {
    if let Some(running) = app.state::<AppState>().sidecar.lock().unwrap().take() {
        unsafe { libc::kill(running.child.pid() as i32, libc::SIGTERM) };
        if running.exited.recv_timeout(std::time::Duration::from_secs(30)).is_err() {
            let _ = running.child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn an_incompatible_server_displays_the_cli_words() {
        let f = Failure::Incompatible { words: "old".into(), replace: None };
        assert_eq!(f.to_string(), "old");
    }
}
