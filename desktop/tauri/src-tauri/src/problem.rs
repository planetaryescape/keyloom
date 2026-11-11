// The window the shell opens when keyloom's server can't start, or keeps stopping (R2-03, R2-09): what happened in plain words, and
// buttons that do the way out. `view` is pure, so every case is a table test; the rest shows it and runs the buttons.
// The page (ui/problem.html) has no IPC. Its buttons are keyloom-desktop://<action> links, caught here before they load.
use crate::{log, sidecar::Failure, AppState};
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "problem";
const SCHEME: &str = "keyloom-desktop";
const PAGE: &str = "tauri://localhost/problem.html";
pub const RELEASES: &str = "https://github.com/planetaryescape/keyloom/releases/latest";

/// Why there is no server to show.
#[derive(Clone, Debug)]
pub enum Stop {
    /// It didn't start.
    Failed(Failure),
    /// It started, then stopped this many times inside the restart window, so the shell stopped restarting it.
    KeepsStopping { times: usize },
}

impl Stop {
    /// The label of the CLI's offer to replace the server that is in the way, when it made one (D-454).
    pub fn replace_label(&self) -> Option<&str> {
        match self {
            Stop::Failed(Failure::Incompatible { replace, .. }) => replace.as_deref(),
            _ => None,
        }
    }

    /// True when the way out is a newer app: another keyloom that this one may not replace is serving the data directory.
    #[cfg_attr(not(feature = "updater"), allow(dead_code))]
    pub fn wants_update(&self) -> bool {
        matches!(self, Stop::Failed(Failure::Incompatible { replace: None, .. }))
    }

    /// The window's heading, and the menu-bar line.
    pub fn title(&self) -> &'static str {
        match self {
            Stop::Failed(Failure::Incompatible { .. }) => "Another keyloom is running",
            Stop::Failed(_) => "keyloom couldn't start",
            Stop::KeepsStopping { .. } => "keyloom keeps stopping",
        }
    }
}

impl std::fmt::Display for Stop {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Stop::Failed(failure) => write!(f, "could not start keyloom: {failure}"),
            Stop::KeepsStopping { times } => write!(f, "keyloom stopped {times} times within {RESTART_WINDOW_WORDS}; not restarting it again"),
        }
    }
}

/// What the updater knows, for the newer-server case. `Off` in a build without the updater.
#[derive(Clone, Debug, PartialEq, Default)]
#[cfg_attr(not(feature = "updater"), allow(dead_code))]
pub enum Updates {
    #[cfg_attr(not(feature = "updater"), default)]
    Off,
    #[cfg_attr(feature = "updater", default)]
    Checking,
    Available(String),
    UpToDate,
    Failed,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Action {
    pub id: &'static str,
    pub label: String,
    pub primary: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct View {
    pub title: String,
    pub body: String,
    pub note: Option<String>,
    pub detail: Option<String>,
    pub busy: bool,
    pub actions: Vec<Action>,
}

pub const TRY_AGAIN: &str = "try-again";
pub const REPLACE: &str = "replace";
pub const CHECK_UPDATES: &str = "check-updates";
pub const INSTALL_UPDATE: &str = "install-update";
pub const DOWNLOAD: &str = "download";
pub const SHOW_LOG: &str = "show-log";

pub const RESTART_WINDOW_WORDS: &str = "10 minutes";

fn action(id: &'static str, label: impl Into<String>) -> Action {
    Action { id, label: label.into(), primary: false }
}

/// The first action is the primary one.
fn actions(mut list: Vec<Action>) -> Vec<Action> {
    if let Some(first) = list.first_mut() {
        first.primary = true;
    }
    list
}

pub fn install_label(version: &str) -> String {
    format!("Install {version} and restart keyloom")
}

// The server's last words: enough to see why, short enough to read in the window. The whole output is in the log.
fn tail(output: &str) -> Option<String> {
    let lines: Vec<&str> = output.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return None;
    }
    Some(lines[lines.len().saturating_sub(12)..].join("\n"))
}

pub fn view(stop: &Stop, updates: &Updates) -> View {
    let try_again = || action(TRY_AGAIN, "Try again");
    let show_log = || action(SHOW_LOG, "Show log");
    let couldnt = stop.title().to_string();
    match stop {
        Stop::Failed(Failure::Incompatible { words, replace: Some(label) }) => View {
            title: stop.title().into(),
            body: words.clone(),
            note: Some("Replacing it waits for any keyboard write to finish, then serves your keyboards from this app.".into()),
            detail: None,
            busy: false,
            actions: actions(vec![action(REPLACE, label.clone()), try_again(), show_log()]),
        },
        Stop::Failed(Failure::Incompatible { words, replace: None }) => {
            let download = || action(DOWNLOAD, "Download the latest keyloom");
            let (note, list) = match updates {
                Updates::Off => ("Install the latest keyloom app over this one, then open it again.".to_string(), vec![download(), try_again(), show_log()]),
                Updates::Checking => ("Checking for a newer version of this app…".to_string(), vec![try_again(), show_log()]),
                Updates::Available(version) => (format!("Version {version} of this app is ready to install."), vec![action(INSTALL_UPDATE, install_label(version)), try_again(), show_log()]),
                Updates::UpToDate => (
                    "This app has no update yet. Install the latest keyloom app over this one, or quit the other keyloom and try again.".to_string(),
                    vec![download(), action(CHECK_UPDATES, "Check for updates"), try_again(), show_log()],
                ),
                Updates::Failed => ("keyloom couldn't check for an update.".to_string(), vec![action(CHECK_UPDATES, "Check for updates"), download(), try_again(), show_log()]),
            };
            View { title: stop.title().into(), body: words.clone(), note: Some(note), detail: None, busy: false, actions: actions(list) }
        }
        Stop::Failed(Failure::TimedOut) => View {
            title: couldnt,
            body: "keyloom's server didn't say it was ready within two minutes.".into(),
            note: Some("Another keyloom may still be finishing a keyboard write. Try again in a moment.".into()),
            detail: None,
            busy: false,
            actions: actions(vec![try_again(), show_log()]),
        },
        Stop::Failed(Failure::Exited { code, output }) => View {
            title: couldnt,
            body: match code {
                Some(code) => format!("keyloom's server stopped before it was ready (exit code {code})."),
                None => "keyloom's server stopped before it was ready.".into(),
            },
            note: Some("Try again. If it stops again, the log shows what it said.".into()),
            detail: tail(output),
            busy: false,
            actions: actions(vec![try_again(), show_log()]),
        },
        Stop::Failed(Failure::PortInUse) => View {
            title: couldnt,
            body: "The port keyloom asked for is in use.".into(),
            note: Some("Try again: keyloom picks a free port when that one is taken.".into()),
            detail: None,
            busy: false,
            actions: actions(vec![try_again(), show_log()]),
        },
        Stop::Failed(Failure::Other(message)) => View {
            title: couldnt,
            body: "The app couldn't run its keyloom server.".into(),
            note: Some("Try again. If it fails again, install the latest keyloom app over this one.".into()),
            detail: Some(message.clone()),
            busy: false,
            actions: actions(vec![try_again(), action(DOWNLOAD, "Download the latest keyloom"), show_log()]),
        },
        Stop::KeepsStopping { times } => View {
            title: stop.title().into(),
            body: format!("keyloom's server stopped {times} times in {RESTART_WINDOW_WORDS}, so the app stopped starting it again."),
            note: Some("The log shows what it said before it stopped.".into()),
            detail: None,
            busy: false,
            actions: actions(vec![try_again(), show_log()]),
        },
    }
}

fn starting() -> View {
    View { title: "Starting keyloom…".into(), body: "This takes a few seconds.".into(), note: None, detail: None, busy: true, actions: actions(vec![action(SHOW_LOG, "Show log")]) }
}

fn page_url(view: &View) -> url::Url {
    let state = serde_json::to_string(view).expect("a view serialises");
    let fragment = url::form_urlencoded::Serializer::new(String::new()).append_pair("state", &state).finish();
    let mut url = url::Url::parse(PAGE).expect("a fixed URL");
    url.set_fragment(Some(&fragment));
    url
}

// Builds or updates the window on the main thread, which window creation needs, and brings it forward.
fn present(app: &AppHandle, view: &View) {
    let url = page_url(view);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = handle.get_webview_window(LABEL) {
            let _ = w.navigate(url);
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let actions = handle.clone();
        let built = WebviewWindowBuilder::new(&handle, LABEL, WebviewUrl::CustomProtocol(url))
            .title("keyloom")
            .inner_size(600.0, 460.0)
            .min_inner_size(420.0, 360.0)
            .center()
            .on_navigation(move |target| {
                if target.scheme() != SCHEME {
                    return true;
                }
                act(&actions, target.host_str().unwrap_or(""));
                false
            })
            .build();
        match built {
            Ok(w) => {
                let _ = w.set_focus();
            }
            Err(err) => log::say(&handle, &format!("the problem window failed: {err}")),
        }
    });
}

/// Shows why there is no server, and keeps it so an updater change can redraw it. While it is kept, Try again and replace may run.
pub fn open(app: &AppHandle, stop: Stop) {
    *app.state::<AppState>().problem.lock().unwrap() = Some(stop);
    refresh(app);
}

/// Draws the kept problem; the updater calls it when it learns something.
pub fn refresh(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Some(stop) = state.problem.lock().unwrap().clone() else { return };
    let updates = state.updates.lock().unwrap().clone();
    present(app, &view(&stop, &updates));
}

/// The server is up: the window goes.
pub fn close(app: &AppHandle) {
    *app.state::<AppState>().problem.lock().unwrap() = None;
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = handle.get_webview_window(LABEL) {
            let _ = w.destroy();
        }
    });
}

/// Brings a window forward; false when there is no window with that label.
pub fn bring_forward(app: &AppHandle, label: &str) -> bool {
    let Some(w) = app.get_webview_window(label) else { return false };
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    true
}

pub fn bring_forward_problem(app: &AppHandle) -> bool {
    bring_forward(app, LABEL)
}

/// A button in the window, or the matching menu-bar item (same ids). Try again and replace run once per problem: the first takes the
/// kept problem, so a double click can't queue a second start.
pub fn act(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    match id {
        TRY_AGAIN | REPLACE => {
            if state.problem.lock().unwrap().take().is_none() {
                return;
            }
            present(app, &starting());
            if id == REPLACE {
                state.replace.notify_one();
            } else {
                state.retry.notify_one();
            }
        }
        SHOW_LOG => log::show(app),
        DOWNLOAD => log::open_external(app, std::ffi::OsStr::new(RELEASES)),
        #[cfg(feature = "updater")]
        CHECK_UPDATES => crate::updates::check_now(app),
        #[cfg(feature = "updater")]
        INSTALL_UPDATE => crate::updates::install(app),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(view: &View) -> Vec<&str> {
        view.actions.iter().map(|a| a.id).collect()
    }

    #[test]
    fn a_server_that_exits_early_says_so_with_its_last_words_and_try_again_first() {
        let v = view(&Stop::Failed(Failure::Exited { code: Some(1), output: "starting\nerror: the database is newer than this keyloom\n".into() }), &Updates::Off);
        assert_eq!(v.title, "keyloom couldn't start");
        assert!(v.body.contains("exit code 1"));
        assert_eq!(v.detail.as_deref(), Some("starting\nerror: the database is newer than this keyloom"));
        assert_eq!(ids(&v), [TRY_AGAIN, SHOW_LOG]);
        assert!(v.actions[0].primary && !v.actions[1].primary);
    }

    #[test]
    fn an_older_server_offers_the_clis_replace_label_first() {
        let v = view(&Stop::Failed(Failure::Incompatible { words: "older".into(), replace: Some("Use this app's keyloom".into()) }), &Updates::Off);
        assert_eq!(v.body, "older");
        assert_eq!(ids(&v), [REPLACE, TRY_AGAIN, SHOW_LOG]);
        assert_eq!(v.actions[0].label, "Use this app's keyloom");
    }

    #[test]
    fn a_newer_server_follows_the_updater() {
        let stop = Stop::Failed(Failure::Incompatible { words: "newer".into(), replace: None });
        assert!(stop.wants_update());
        assert_eq!(ids(&view(&stop, &Updates::Off))[0], DOWNLOAD);
        assert_eq!(ids(&view(&stop, &Updates::Checking)), [TRY_AGAIN, SHOW_LOG]);
        let available = view(&stop, &Updates::Available("0.80.0".into()));
        assert_eq!(available.actions[0].id, INSTALL_UPDATE);
        assert_eq!(available.actions[0].label, "Install 0.80.0 and restart keyloom");
        assert_eq!(ids(&view(&stop, &Updates::UpToDate))[..2], [DOWNLOAD, CHECK_UPDATES]);
        assert_eq!(ids(&view(&stop, &Updates::Failed))[..2], [CHECK_UPDATES, DOWNLOAD]);
    }

    #[test]
    fn only_a_newer_server_asks_for_an_update() {
        assert!(!Stop::Failed(Failure::Incompatible { words: "x".into(), replace: Some("r".into()) }).wants_update());
        assert!(!Stop::Failed(Failure::TimedOut).wants_update());
        assert!(!Stop::KeepsStopping { times: 3 }.wants_update());
    }

    #[test]
    fn a_server_that_keeps_stopping_says_how_often() {
        let v = view(&Stop::KeepsStopping { times: 3 }, &Updates::Off);
        assert!(v.body.contains("3 times in 10 minutes"));
        assert_eq!(ids(&v), [TRY_AGAIN, SHOW_LOG]);
    }

    #[test]
    fn every_view_has_a_way_on() {
        let stops = [
            Stop::Failed(Failure::TimedOut),
            Stop::Failed(Failure::PortInUse),
            Stop::Failed(Failure::Other("spawn failed".into())),
            Stop::Failed(Failure::Exited { code: None, output: String::new() }),
            Stop::KeepsStopping { times: 3 },
        ];
        for stop in &stops {
            let v = view(stop, &Updates::Off);
            assert_eq!(v.actions.iter().filter(|a| a.primary).count(), 1, "{stop}");
            assert!(v.actions.iter().any(|a| a.id == TRY_AGAIN), "{stop}");
        }
    }

    #[test]
    fn the_page_reads_its_state_from_the_fragment() {
        let url = page_url(&view(&Stop::Failed(Failure::TimedOut), &Updates::Off));
        assert_eq!(url.scheme(), "tauri");
        assert_eq!(url.path(), "/problem.html");
        let fragment = url.fragment().expect("a fragment");
        let state = url::form_urlencoded::parse(fragment.as_bytes()).find(|(k, _)| k == "state").expect("state").1;
        let json: serde_json::Value = serde_json::from_str(&state).expect("json");
        assert_eq!(json["title"], "keyloom couldn't start");
        assert_eq!(json["actions"][0]["id"], TRY_AGAIN);
    }

    #[test]
    fn the_tail_keeps_the_last_twelve_lines() {
        let output = (1..=20).map(|n| n.to_string()).collect::<Vec<_>>().join("\n");
        assert_eq!(tail(&output).unwrap().lines().next(), Some("9"));
        assert_eq!(tail("\n \n"), None);
    }
}
