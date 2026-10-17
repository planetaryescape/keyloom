// Starts the bundled `keyloom serve`, or finds the one already serving this data directory (D-323). All the deciding is the CLI's:
// the shell passes flags and reads the URL line, so there is no product logic here.
use crate::{AppState, Server};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

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

pub async fn start(app: &AppHandle) -> Result<Server, String> {
    let wanted = remembered_port(app);
    match launch(app, wanted).await {
        // `serve` refuses a port that is in use; any other free port will do.
        Err(Failure::PortInUse) if wanted != 0 => launch(app, 0).await.map_err(|f| f.to_string()),
        other => other.map_err(|f| f.to_string()),
    }
}

enum Failure {
    PortInUse,
    Other(String),
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Failure::PortInUse => write!(f, "the port keyloom asked for is in use"),
            Failure::Other(m) => write!(f, "{m}"),
        }
    }
}

async fn launch(app: &AppHandle, port: u16) -> Result<Server, Failure> {
    let other = |e: &dyn std::fmt::Display| Failure::Other(e.to_string());
    let (mut rx, child) = app
        .shell()
        .sidecar("keyloom")
        .map_err(|e| other(&e))?
        // --reuse: a server already on this data directory (BK's browser one) is attached to, not doubled (it would run a second sync engine).
        // --exit-on-stdin-close: the pipe the shell holds closes when the shell dies, however it dies.
        .args(["serve", "--port", &port.to_string(), "--no-open", "--exit-on-stdin-close", "--reuse"])
        .spawn()
        .map_err(|e| other(&e))?;

    let (exit_tx, exited) = std::sync::mpsc::channel();
    let mut child = Some(child);
    let mut stderr = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
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
                return Err(if stderr.contains("is in use") { Failure::PortInUse } else { Failure::Other(format!("keyloom exited early ({:?}): {}", p.code, stderr.trim())) });
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
