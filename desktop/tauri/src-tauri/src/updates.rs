// Compiled only with the `updater` feature, which a build has when it carries Tauri's updater signing key (desktop/tauri/README.md).
// Checks at launch, every six hours, and whenever the person asks (the menu item after a check, or the problem window when a newer
// keyloom is in the way). Installing is an explicit choice; after a successful install, restart through Tauri's exit path so the
// sidecar is stopped first.
use crate::{log, problem, problem::Updates, AppState};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Manager, Wry,
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

// What the menu item says after a check that offers nothing to install. Both stay enabled, so a check never waits six hours (R2-15).
const CHECK_AGAIN: &str = "Check for updates";
const CHECK_FAILED: &str = "Couldn't check for updates. Try again";

fn set(app: &AppHandle, updates: Updates) {
    *app.state::<AppState>().updates.lock().unwrap() = updates;
    problem::refresh(app);
}

/// The menu item and the problem window's Check for updates. Ignored while an update is offered: the item installs it then.
pub fn check_now(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !state.update_offered.load(Ordering::Acquire) {
        state.check_updates.notify_one();
    }
}

/// Install the offered update, if one is offered.
pub fn install(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.update_offered.swap(false, Ordering::AcqRel) {
        state.install_update.notify_waiters();
    }
}

/// The menu item: installs an offered update, otherwise checks again.
pub fn menu_item(app: &AppHandle) {
    if app.state::<AppState>().update_offered.load(Ordering::Acquire) {
        install(app);
    } else {
        check_now(app);
    }
}

pub async fn watch(app: AppHandle, menu: Menu<Wry>, item: MenuItem<Wry>) {
    let mut checks = tokio::time::interval_at(tokio::time::Instant::now() + CHECK_INTERVAL, CHECK_INTERVAL);
    let state = app.state::<AppState>();
    // "Download the latest keyloom", in the menu only while an install has failed (R3-15).
    let download = MenuItem::with_id(&app, problem::DOWNLOAD, "Download the latest keyloom", true, None::<&str>).ok();
    'check: loop {
        let _ = item.set_text("Checking for updates…");
        let _ = item.set_enabled(false);
        set(&app, Updates::Checking);
        let check = async { app.updater()?.check().await }.await;
        match check {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let label = problem::install_label(&version);
                notify(&app, "keyloom update available", &format!("Version {version} is ready. Choose “{label}” from the keyloom menu to install and restart."));
                // Offered until it installs, the next check comes round, or it fails and is offered again with the reason.
                let mut failed: Option<String> = None;
                loop {
                    let _ = item.set_enabled(true);
                    let selected = state.install_update.notified();
                    tokio::pin!(selected);
                    selected.as_mut().enable();
                    state.update_offered.store(true, Ordering::Release);
                    match &failed {
                        None => {
                            let _ = item.set_text(&label);
                            set(&app, Updates::Available(version.clone()));
                        }
                        Some(reason) => {
                            let _ = item.set_text(problem::retry_install_label(&version));
                            set(&app, Updates::InstallFailed { version: version.clone(), reason: reason.clone() });
                        }
                    }
                    let should_install = tokio::select! {
                        _ = &mut selected => true,
                        _ = checks.tick() => false,
                    };
                    let _ = item.set_enabled(false);
                    state.update_offered.store(false, Ordering::Release);
                    if let Some(download) = &download {
                        let _ = menu.remove(download);
                    }
                    if !should_install {
                        // The next check is due: check now, rather than wait out another interval with the offer withdrawn.
                        continue 'check;
                    }
                    let _ = item.set_text(problem::installing_words(&version, None));
                    set(&app, Updates::Installing { version: version.clone(), percent: None });
                    let mut progress = Progress::default();
                    let shown = |percent: Option<u8>| {
                        let _ = item.set_text(problem::installing_words(&version, percent));
                        set(&app, Updates::Installing { version: version.clone(), percent });
                    };
                    let installed = update
                        .download_and_install(
                            |chunk, total| {
                                if let Some(percent) = progress.add(chunk, total) {
                                    shown(Some(percent));
                                }
                            },
                            || {},
                        )
                        .await;
                    match installed {
                        Ok(()) => {
                            app.request_restart();
                            return;
                        }
                        Err(err) => {
                            log::say(&app, &format!("update installation failed: {err}"));
                            notify(&app, "keyloom update failed", &format!("Version {version} didn't install: {err}. Choose “{}” from the keyloom menu, or download the latest keyloom.", problem::retry_install_label(&version)));
                            if let Some(download) = &download {
                                if let Some(at) = menu.items().ok().and_then(|items| items.iter().position(|i| i.id() == "update")) {
                                    let _ = menu.insert(download, at + 1);
                                }
                            }
                            failed = Some(err.to_string());
                        }
                    }
                }
            }
            Ok(None) => {
                let _ = item.set_text(CHECK_AGAIN);
                let _ = item.set_enabled(true);
                set(&app, Updates::UpToDate);
            }
            Err(err) => {
                log::say(&app, &format!("update check failed: {err}"));
                let _ = item.set_text(CHECK_FAILED);
                let _ = item.set_enabled(true);
                set(&app, Updates::Failed);
            }
        }
        tokio::select! {
            _ = checks.tick() => {}
            _ = state.check_updates.notified() => {}
        }
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    if let Err(err) = app.notification().builder().title(title).body(body).show() {
        log::say(app, &format!("update notification failed: {err}"));
    }
}

/// Counts a download's bytes and says when the whole percentage it has reached moves on by at least STEP, so the menu item and the
/// problem window redraw about twenty times, not once per chunk. None when the server didn't say how big the download is.
#[derive(Default)]
struct Progress {
    received: u64,
    shown: Option<u8>,
}

const STEP: u8 = 5;

impl Progress {
    fn add(&mut self, chunk: usize, total: Option<u64>) -> Option<u8> {
        self.received += chunk as u64;
        let total = total.filter(|t| *t > 0)?;
        let percent = (self.received.min(total) * 100 / total) as u8;
        if self.shown.is_some_and(|s| percent < s.saturating_add(STEP) && percent < 100) {
            return None;
        }
        self.shown = Some(percent);
        Some(percent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_action_says_it_installs_and_restarts() {
        assert_eq!(problem::install_label("0.71.2"), "Install 0.71.2 and restart keyloom");
        assert_eq!(problem::retry_install_label("0.71.2"), "Couldn't install 0.71.2. Try again");
    }

    #[test]
    fn progress_moves_in_steps_and_ends_at_a_hundred() {
        let mut p = Progress::default();
        assert_eq!(p.add(10, None), None, "no size, no percentage");
        let mut p = Progress::default();
        assert_eq!(p.add(1, Some(100)), Some(1));
        assert_eq!(p.add(2, Some(100)), None, "3% is under a step past 1%");
        assert_eq!(p.add(3, Some(100)), Some(6));
        assert_eq!(p.add(94, Some(100)), Some(100));
        assert_eq!(p.add(0, Some(100)), Some(100), "a last empty chunk still says it is done");
    }
}
