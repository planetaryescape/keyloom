// Compiled only with the `updater` feature, which a build has when it carries Tauri's updater signing key (desktop/tauri/README.md).
// Checks at launch and every six hours. Installing is an explicit choice from the menu bar;
// after a successful install, restart through Tauri's exit path so the sidecar is stopped first.
use std::time::Duration;
use tauri::{menu::MenuItem, AppHandle, Manager, Wry};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

pub async fn watch(app: AppHandle, item: MenuItem<Wry>) {
    loop {
        let check = async { app.updater()?.check().await }.await;
        match check {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let label = install_label(&version);
                let _ = item.set_text(&label);
                let _ = item.set_enabled(true);
                if let Err(err) = app
                    .notification()
                    .builder()
                    .title("keyloom update available")
                    .body(format!("Version {version} is ready. Choose “{label}” from the keyloom menu to install and restart."))
                    .show()
                {
                    eprintln!("keyloom-desktop: update notification failed: {err}");
                }

                app.state::<crate::AppState>()
                    .install_update
                    .notified()
                    .await;
                let _ = item.set_enabled(false);
                let _ = item.set_text(format!("Installing version {version}…"));
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => app.request_restart(),
                    Err(err) => {
                        eprintln!("keyloom-desktop: update installation failed: {err}");
                        let _ = item.set_text(&label);
                        let _ = item.set_enabled(true);
                        if let Err(notification_err) = app
                            .notification()
                            .builder()
                            .title("keyloom update failed")
                            .body(format!("Version {version} could not be installed. You can try again from the keyloom menu."))
                            .show()
                        {
                            eprintln!("keyloom-desktop: update failure notification failed: {notification_err}");
                        }
                        tokio::time::sleep(CHECK_INTERVAL).await;
                    }
                }
            }
            Ok(None) => {
                let _ = item.set_text("No updates available");
            }
            Err(err) => {
                eprintln!("keyloom-desktop: update check failed: {err}");
                let _ = item.set_text("Update check failed");
            }
        }
        tokio::time::sleep(CHECK_INTERVAL).await;
    }
}

fn install_label(version: &str) -> String {
    format!("Install {version} and restart keyloom")
}

#[cfg(test)]
mod tests {
    use super::install_label;

    #[test]
    fn update_action_says_it_installs_and_restarts() {
        assert_eq!(
            install_label("0.71.2"),
            "Install 0.71.2 and restart keyloom"
        );
    }
}
