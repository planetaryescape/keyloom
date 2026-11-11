// Mirrors GET /api/events into the menu-bar extra and native notifications. The server words everything (`menuBar` in each frame,
// src/server/menu-bar.ts), so this file only displays strings and relays clicks (D-325).
use crate::{log, sidecar, AppState};
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

pub(crate) fn notify(app: &AppHandle, title: &str, body: &str) {
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

/// Mirrors the server into the menu bar, and returns once the server is gone: the one this shell started has exited, or one it
/// attached to stopped answering. The supervisor (lib.rs) then starts one again, through the same path as at launch.
pub async fn watch(app: &AppHandle, tray: &TrayIcon, items: &Items) {
    let client = reqwest::Client::new();
    let mut failures = 0u32;
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
            // A server that keeps refusing would write a line every 2 s for as long as the app runs; the 1st, 2nd, 4th, 8th… are enough.
            Ok(resp) if (failures + 1).is_power_of_two() => log::say(app, &format!("/api/events answered {}", resp.status())),
            Err(err) if (failures + 1).is_power_of_two() => log::say(app, &format!("/api/events: {err}")),
            _ => {}
        }
        failures += 1;
        // The server this shell started has exited; or one it attached to (BK's browser one) stopped answering, and whoever started it
        // may have stopped it. Either way the shell starts its own, the way it did at launch, once the old one is clearly gone.
        let gone = if owned { sidecar::exited(app) } else { failures >= GIVE_UP_ATTACHED_AFTER };
        if gone {
            return;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

// Sync now while keyloom builds or flashes is refused as `busy`, and one started after that work ends can succeed, so the menu bar asks
// again by itself, as the page does (src/web/sync/busy-retry.ts, R4-15). Same pace and limit as the page.
const BUSY_RETRY_EVERY: Duration = Duration::from_secs(3);
const BUSY_RETRY_FOR: Duration = Duration::from_secs(15 * 60);
// One wait at a time: a second Sync now while one waits would only post the same sync twice.
static WAITING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn server(app: &AppHandle) -> Option<(String, String)> {
    let state = app.state::<AppState>();
    let guard = state.server.lock().unwrap();
    guard.as_ref().map(|s| (s.origin.clone(), s.token.clone()))
}

// Posts the request the web app's Sync button posts, for the config the server says is waiting; the stream reports the result.
pub fn sync_now(app: &AppHandle) {
    if WAITING.swap(true, std::sync::atomic::Ordering::AcqRel) {
        log::say(app, "sync now: already waiting for keyloom to finish building or flashing");
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        let started = tokio::time::Instant::now();
        let mut said_busy = false;
        let notice = loop {
            // The config waiting can change while keyloom is busy, and the busy work may have been this sync: then there is nothing left to do.
            let layout_id = app.state::<AppState>().sync_layout.lock().unwrap().clone();
            let (Some(layout_id), Some((origin, token))) = (layout_id, server(&app)) else { break None };
            let outcome = post_sync(&app, &client, &origin, &token, &layout_id).await;
            match outcome {
                SyncNow::Synced => break None,
                SyncNow::Busy => {
                    if app.state::<AppState>().quit.is_set() {
                        break None;
                    }
                    if started.elapsed() >= BUSY_RETRY_FOR {
                        break Some(sync_now_notice_timed_out());
                    }
                    if !said_busy {
                        said_busy = true;
                        let (title, body) = sync_now_notice(SyncNow::Busy);
                        notify(&app, title, body);
                    }
                    tokio::time::sleep(BUSY_RETRY_EVERY).await;
                }
                other => break Some(sync_now_notice(other)),
            }
        };
        WAITING.store(false, std::sync::atomic::Ordering::Release);
        // The page shows the keyboard's state with a button for the way on, so the notice says why in short and opens it (R3-17).
        if let Some((title, body)) = notice {
            notify(&app, title, body);
            crate::show_window(&app);
        }
    });
}

async fn post_sync(app: &AppHandle, client: &reqwest::Client, origin: &str, token: &str, layout_id: &str) -> SyncNow {
    let res = client
        .post(format!("{origin}/api/sync"))
        .header("x-keyloom-token", token)
        .json(&serde_json::json!({ "layoutId": layout_id }))
        .send()
        .await;
    match res {
        Ok(resp) => {
            let status = resp.status();
            let code = if status.is_success() {
                None
            } else {
                resp.json::<serde_json::Value>().await.ok().and_then(|body| body["error"]["code"].as_str().map(str::to_string))
            };
            log::say(app, &format!("sync now -> {status} {}", code.as_deref().unwrap_or("")));
            answered(status.is_success(), code.as_deref())
        }
        Err(err) => {
            log::say(app, &format!("sync now -> {err}"));
            SyncNow::Unreachable
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum SyncNow {
    Synced,
    /// keyloom is building or flashing; a sync after that can work.
    Busy,
    /// keyloom answered and turned the sync down.
    Refused,
    /// keyloom's server didn't answer.
    Unreachable,
}

// The refusal code, never its sentence (src/app/sync-engine.ts SyncRefusal).
fn answered(ok: bool, code: Option<&str>) -> SyncNow {
    match (ok, code) {
        (true, _) => SyncNow::Synced,
        (false, Some("busy")) => SyncNow::Busy,
        (false, _) => SyncNow::Refused,
    }
}

// The server's refusal sentences name terminal commands for the CLI, so the notice doesn't repeat them: the page has the buttons.
fn sync_now_notice(outcome: SyncNow) -> (&'static str, &'static str) {
    match outcome {
        SyncNow::Busy => ("keyloom is building or flashing", "keyloom syncs this keyboard when that finishes."),
        SyncNow::Synced | SyncNow::Refused => ("keyloom didn't sync", "keyloom can't sync this keyboard right now. keyloom is open with what to do."),
        SyncNow::Unreachable => ("keyloom didn't sync", "keyloom's server didn't answer. keyloom is open; try Sync now again when it shows your keyboard."),
    }
}

fn sync_now_notice_timed_out() -> (&'static str, &'static str) {
    ("keyloom is still building or flashing", "It has been busy for 15 minutes, so keyloom stopped waiting to sync. keyloom is open with what is running.")
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
    fn a_busy_sync_now_waits_and_says_it_will_sync() {
        assert_eq!(answered(false, Some("busy")), SyncNow::Busy);
        assert_eq!(answered(false, Some("foreign_firmware")), SyncNow::Refused);
        assert_eq!(answered(false, None), SyncNow::Refused);
        assert_eq!(answered(true, None), SyncNow::Synced);
        let (title, body) = sync_now_notice(SyncNow::Busy);
        assert_eq!(title, "keyloom is building or flashing");
        assert_eq!(body, "keyloom syncs this keyboard when that finishes.");
        let (title, body) = sync_now_notice_timed_out();
        assert_eq!(title, "keyloom is still building or flashing");
        assert!(body.contains("15 minutes") && body.contains("keyloom is open"), "{body}");
        assert_eq!(BUSY_RETRY_FOR.as_secs(), 15 * 60, "the words say 15 minutes");
    }

    #[test]
    fn a_refused_or_unanswered_sync_now_says_what_to_do_and_never_a_terminal_command() {
        for outcome in [SyncNow::Refused, SyncNow::Unreachable] {
            let (title, body) = sync_now_notice(outcome);
            assert_eq!(title, "keyloom didn't sync");
            assert!(body.contains("keyloom is open"), "{body}");
            assert!(!body.contains('`') && !body.contains("keyloom sync"), "{body}");
        }
    }

    #[test]
    fn comments_and_frames_from_an_older_server_are_ignored() {
        assert!(parse_frame(": keepalive\n\n").is_none());
        assert!(parse_frame("event: sync\ndata: {\"type\":\"sync\",\"boards\":[]}\n\n").is_none());
    }
}
