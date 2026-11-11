// Compiled only with the `updater` feature, which a build has when it carries Tauri's updater signing key (desktop/tauri/README.md).
// Checks at launch, every six hours, and whenever the person asks (the menu item after a check, or the problem window when a newer
// keyloom is in the way). Installing is an explicit choice; after a successful install, restart through Tauri's exit path so the
// sidecar is stopped first.
use crate::{log, problem, problem::Updates, AppState};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{menu::MenuItem, AppHandle, Manager, Wry};
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

pub async fn watch(app: AppHandle, item: MenuItem<Wry>) {
    let mut checks = tokio::time::interval_at(tokio::time::Instant::now() + CHECK_INTERVAL, CHECK_INTERVAL);
    let state = app.state::<AppState>();
    loop {
        let _ = item.set_text("Checking for updates…");
        let _ = item.set_enabled(false);
        set(&app, Updates::Checking);
        let check = async { app.updater()?.check().await }.await;
        match check {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let label = problem::install_label(&version);
                let _ = item.set_text(&label);
                let _ = item.set_enabled(true);
                if let Err(err) = app
                    .notification()
                    .builder()
                    .title("keyloom update available")
                    .body(format!("Version {version} is ready. Choose “{label}” from the keyloom menu to install and restart."))
                    .show()
                {
                    log::say(&app, &format!("update notification failed: {err}"));
                }

                let selected = state.install_update.notified();
                tokio::pin!(selected);
                selected.as_mut().enable();
                state.update_offered.store(true, Ordering::Release);
                set(&app, Updates::Available(version.clone()));
                let should_install = tokio::select! {
                    _ = &mut selected => true,
                    _ = checks.tick() => false,
                };
                let _ = item.set_enabled(false);
                state.update_offered.store(false, Ordering::Release);
                if !should_install {
                    continue;
                }
                let _ = item.set_text(format!("Installing version {version}…"));
                set(&app, Updates::Installing(version.clone()));
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => app.request_restart(),
                    Err(err) => {
                        log::say(&app, &format!("update installation failed: {err}"));
                        if let Err(notification_err) = app
                            .notification()
                            .builder()
                            .title("keyloom update failed")
                            .body(format!("Version {version} could not be installed. You can try again from the keyloom menu."))
                            .show()
                        {
                            log::say(&app, &format!("update failure notification failed: {notification_err}"));
                        }
                        // Check again at once: it offers the same version, so the install item is back and can be retried.
                        continue;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_action_says_it_installs_and_restarts() {
        assert_eq!(problem::install_label("0.71.2"), "Install 0.71.2 and restart keyloom");
    }
}
