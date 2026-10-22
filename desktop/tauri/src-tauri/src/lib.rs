// Native shell around the unchanged `keyloom serve`: runs (or attaches to) the server, shows its page in a window, and puts the
// sync line in the menu bar. No product logic lives here (chapter 26); the server words every string the shell shows.
mod login_path;
mod menu_bar;
mod sidecar;
#[cfg(feature = "updater")]
mod updates;

use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

pub struct Server {
    pub url: String,
    pub origin: String,
    pub token: String,
    /// False when the server was already running and the shell attached to it; the shell then never stops it.
    pub owned: bool,
}

#[derive(Default)]
pub struct AppState {
    pub server: Mutex<Option<Server>>,
    pub sidecar: Mutex<Option<sidecar::Running>>,
    pub sync_layout: Mutex<Option<String>>,
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn navigate(app: &AppHandle, url: &str) {
    if let (Some(w), Ok(url)) = (app.get_webview_window("main"), url.parse()) {
        let _ = w.navigate(url);
    }
}

fn open_window(app: &AppHandle, url: &str) -> tauri::Result<()> {
    let url = url.parse().expect("the server printed a valid url");
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("keyloom")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .build()?;
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_window(app)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None));
    // The updater is compiled in only for builds that have its signing key (desktop/tauri/README.md), so a build without one cannot try to update.
    #[cfg(feature = "updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let app = builder
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();

            let summary = MenuItem::with_id(&handle, "summary", "Starting", false, None::<&str>)?;
            let sync_now = MenuItem::with_id(&handle, "sync_now", "Sync now", false, None::<&str>)?;
            let open = MenuItem::with_id(&handle, "open", "Open keyloom", true, None::<&str>)?;
            // Off until BK turns it on: nothing registers a login item by itself.
            let login = CheckMenuItem::with_id(&handle, "login", "Launch at login", true, handle.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
            let quit = MenuItem::with_id(&handle, "quit", "Quit keyloom", true, Some("CmdOrCtrl+Q"))?;
            let menu = Menu::with_items(
                &handle,
                &[&summary, &menu_bar::separator(&handle)?, &sync_now, &open, &login, &menu_bar::separator(&handle)?, &quit],
            )?;

            let tray = TrayIconBuilder::with_id("tray")
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .tooltip("keyloom")
                .menu(&menu)
                .on_menu_event({
                    let login = login.clone();
                    move |app, event| match event.id().as_ref() {
                        "open" => show_window(app),
                        "sync_now" => menu_bar::sync_now(app),
                        "login" => {
                            let manager = app.autolaunch();
                            let result = if manager.is_enabled().unwrap_or(false) { manager.disable() } else { manager.enable() };
                            if let Err(err) = result {
                                eprintln!("keyloom-desktop: launch at login failed: {err}");
                            }
                            let _ = login.set_checked(manager.is_enabled().unwrap_or(false));
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .build(&handle)?;

            // A SIGTERM/SIGINT to the shell skips RunEvent::Exit and would orphan the sidecar (observed in the spike), so route it through app.exit.
            let sig_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                use tokio::signal::unix::{signal, SignalKind};
                let (mut term, mut int) = (signal(SignalKind::terminate()).unwrap(), signal(SignalKind::interrupt()).unwrap());
                tokio::select! { _ = term.recv() => {}, _ = int.recv() => {} }
                sig_handle.exit(0);
            });

            #[cfg(feature = "updater")]
            tauri::async_runtime::spawn(updates::watch(handle.clone()));

            // Everything that waits on the server runs off the setup thread so the menu-bar extra shows at once.
            let handle2 = handle.clone();
            tauri::async_runtime::spawn(async move {
                match sidecar::start(&handle2).await {
                    Ok(server) => {
                        let url = server.url.clone();
                        *handle2.state::<AppState>().server.lock().unwrap() = Some(server);
                        let h = handle2.clone();
                        // Window creation must happen on the main thread.
                        let _ = handle2.run_on_main_thread(move || {
                            if let Err(err) = open_window(&h, &url) {
                                eprintln!("keyloom-desktop: window failed: {err}");
                            }
                        });
                        let items = menu_bar::Items { menu, summary, sync_now, lines: Mutex::new(Vec::new()) };
                        menu_bar::watch(handle2, tray, items).await;
                    }
                    Err(err) => {
                        eprintln!("keyloom-desktop: could not start keyloom: {err}");
                        let _ = summary.set_text(format!("keyloom could not start: {err}"));
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps the menu-bar extra and its watcher alive; Quit (menu bar or Cmd+Q) ends the app.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building keyloom-desktop");

    app.run(|app, event| match event {
        RunEvent::Reopen { .. } => show_window(app),
        RunEvent::Exit => sidecar::stop(app),
        _ => {}
    });
}
