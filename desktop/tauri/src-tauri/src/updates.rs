// Compiled only with the `updater` feature, which a build has when it carries Tauri's updater signing key (desktop/tauri/README.md).
// Checks at launch and every six hours, installs what it finds and says so; the new version runs after the next launch.
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

pub async fn watch(app: AppHandle) {
    loop {
        match check(&app).await {
            Ok(Some(version)) => {
                let _ = app.notification().builder().title("keyloom was updated").body(format!("Version {version} runs the next time you open keyloom.")).show();
            }
            Ok(None) => {}
            Err(err) => eprintln!("keyloom-desktop: update check failed: {err}"),
        }
        tokio::time::sleep(Duration::from_secs(6 * 60 * 60)).await;
    }
}

async fn check(app: &AppHandle) -> tauri_plugin_updater::Result<Option<String>> {
    let Some(update) = app.updater()?.check().await? else { return Ok(None) };
    update.download_and_install(|_, _| {}, || {}).await?;
    Ok(Some(update.version.clone()))
}
