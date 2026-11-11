// Mirrors GET /api/events into the menu-bar extra and native notifications. The server words everything (`menuBar` in each frame,
// src/server/menu-bar.ts), so this file only displays strings and relays clicks (D-325).
use crate::{log, problem::Stop, restarts::Restarts, sidecar, AppState};
use futures_util::StreamExt;
use serde::Deserialize;
use std::time::Duration;
use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem}, tray::TrayIcon, AppHandle, Manager, Wry};
use tauri_plugin_notification::NotificationExt;

#[derive(Deserialize, PartialEq, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub text: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub title: String,
    pub body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBar {
    pub summary: String,
    pub title: Option<String>,
    pub lines: Vec<Line>,
    pub sync_layout_id: Option<String>,
    pub notices: Vec<Notice>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    menu_bar: Option<MenuBar>,
}

/// The tray's menu items that change with the frames.
pub struct Items {
    pub menu: Menu<Wry>,
    pub summary: MenuItem<Wry>,
    pub sync_now: MenuItem<Wry>,
    pub lines: std::sync::Mutex<Vec<MenuItem<Wry>>>,
}

/// One SSE frame's `data:` payload, or None for a comment or an incomplete frame.
fn data_of(frame: &str) -> String {
    frame.lines().filter_map(|l| l.strip_prefix("data: ")).collect()
}

pub fn parse_frame(frame: &str) -> Option<MenuBar> {
    let data = data_of(frame);
    if data.is_empty() {
        return None;
    }
    serde_json::from_str::<Frame>(&data).ok()?.menu_bar
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    if let Err(err) = app.notification().builder().title(title).body(body).show() {
        log::say(app, &format!("notification failed: {err}"));
    }
}

fn apply(app: &AppHandle, tray: &TrayIcon, items: &Items, bar: &MenuBar) {
    let _ = items.summary.set_text(&bar.summary);
    let _ = items.sync_now.set_enabled(bar.sync_layout_id.is_some());
    *app.state::<AppState>().sync_layout.lock().unwrap() = bar.sync_layout_id.clone();
    let _ = tray.set_title(bar.title.as_deref());
    let all = bar.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
    let _ = tray.set_tooltip(Some(format!("keyloom\n{all}")));
    // One disabled line per keyboard under the summary, rebuilt when the set of lines changes.
    let mut current = items.lines.lock().unwrap();
    let same = current.len() == bar.lines.len() && current.iter().zip(&bar.lines).all(|(item, line)| item.text().ok().as_deref() == Some(line.text.as_str()));
    if !same && bar.lines.len() > 1 {
        for item in current.drain(..) {
            let _ = items.menu.remove(&item);
        }
        for (i, line) in bar.lines.iter().enumerate() {
            if let Ok(item) = MenuItem::new(app, &line.text, false, None::<&str>) {
                let _ = items.menu.insert(&item, 1 + i);
                current.push(item);
            }
        }
    } else if bar.lines.len() <= 1 {
        for item in current.drain(..) {
            let _ = items.menu.remove(&item);
        }
    }
    for n in &bar.notices {
        notify(app, &n.title, &n.body);
    }
}

pub fn separator(app: &AppHandle) -> tauri::Result<PredefinedMenuItem<Wry>> {
    PredefinedMenuItem::separator(app)
}

const GIVE_UP_ATTACHED_AFTER: u32 = 3;

/// Mirrors the server into the menu bar until there is no server to show. A server that stops is started again through the same path
/// as at launch, with a back-off and a cap (restarts.rs); the return says why the shell gave up, for the problem window.
pub async fn watch(app: &AppHandle, tray: &TrayIcon, items: &Items) -> Stop {
    let client = reqwest::Client::new();
    let mut failures = 0u32;
    let mut restarts = Restarts::default();
    loop {
        let (origin, token, owned) = {
            let state = app.state::<AppState>();
            let guard = state.server.lock().unwrap();
            let s = guard.as_ref().expect("server is set before the watcher starts");
            (s.origin.clone(), s.token.clone(), s.owned)
        };
        match client.get(format!("{origin}/api/events")).header("x-keyloom-token", &token).send().await {
            Ok(resp) if resp.status().is_success() => {
                failures = 0;
                let mut stream = resp.bytes_stream();
                let mut buf = String::new();
                while let Some(Ok(chunk)) = stream.next().await {
                    buf.push_str(&String::from_utf8_lossy(&chunk));
                    while let Some(end) = buf.find("\n\n") {
                        let frame: String = buf.drain(..end + 2).collect();
                        if let Some(bar) = parse_frame(&frame) {
                            apply(app, tray, items, &bar);
                        }
                    }
                }
            }
            Ok(resp) => log::say(app, &format!("/api/events answered {}", resp.status())),
            Err(err) => log::say(app, &format!("/api/events: {err}")),
        }
        failures += 1;
        // Quitting stops the server on purpose; starting it again would undo that.
        if app.state::<AppState>().quitting.load(std::sync::atomic::Ordering::Acquire) {
            return std::future::pending().await;
        }
        // The server this shell started has exited; or one it attached to (BK's browser one) stopped answering, and whoever started it
        // may have stopped it. Either way the shell starts its own, the way it did at launch, once the old one is clearly gone.
        let gone = if owned { sidecar::exited(app) } else { failures >= GIVE_UP_ATTACHED_AFTER };
        if gone {
            let Some(delay) = restarts.next(std::time::Instant::now()) else {
                return Stop::KeepsStopping { times: restarts.stops() };
            };
            log::say(app, &format!("keyloom's server is gone; starting it again in {} s", delay.as_secs()));
            let _ = items.summary.set_text("keyloom stopped. Starting it again…");
            tokio::time::sleep(delay).await;
            match sidecar::start(app, sidecar::Mode::Reuse).await {
                Ok(server) => {
                    crate::navigate(app, &server.url);
                    *app.state::<AppState>().server.lock().unwrap() = Some(server);
                    failures = 0;
                }
                // A server that came back and can't work with this app: the problem window says so, with its way out.
                Err(failure @ sidecar::Failure::Incompatible { .. }) => return Stop::Failed(failure),
                Err(err) => log::say(app, &format!("could not start keyloom again: {err}")),
            }
            continue;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

// Posts the request the web app's Sync button posts, for the config the server says is waiting; the stream reports the result.
pub fn sync_now(app: &AppHandle) {
    let Some(layout_id) = app.state::<AppState>().sync_layout.lock().unwrap().clone() else { return };
    let (origin, token) = {
        let state = app.state::<AppState>();
        let guard = state.server.lock().unwrap();
        match guard.as_ref() {
            Some(s) => (s.origin.clone(), s.token.clone()),
            None => return,
        }
    };
    tauri::async_runtime::spawn(async move {
        let res = reqwest::Client::new()
            .post(format!("{origin}/api/sync"))
            .header("x-keyloom-token", &token)
            .json(&serde_json::json!({ "layoutId": layout_id }))
            .send()
            .await;
        eprintln!("keyloom-desktop: sync now -> {:?}", res.map(|r| r.status()));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_menu_bar_out_of_a_sync_frame() {
        let frame = r#"event: sync
data: {"type":"sync","boards":[],"menuBar":{"summary":"2 changes not on your Moonlander","title":"Behind","lines":[{"boardId":"zsa/moonlander","text":"2 changes not on your Moonlander"}],"syncLayoutId":"lay_1","notices":[{"title":"On your Glove80","body":"4 s from your change."}]}}

"#;
        let bar = parse_frame(frame).expect("a menu bar");
        assert_eq!(bar.summary, "2 changes not on your Moonlander");
        assert_eq!(bar.title.as_deref(), Some("Behind"));
        assert_eq!(bar.sync_layout_id.as_deref(), Some("lay_1"));
        assert_eq!(bar.notices[0].title, "On your Glove80");
    }

    #[test]
    fn comments_and_frames_from_an_older_server_are_ignored() {
        assert!(parse_frame(": keepalive\n\n").is_none());
        assert!(parse_frame("event: sync\ndata: {\"type\":\"sync\",\"boards\":[]}\n\n").is_none());
    }
}
