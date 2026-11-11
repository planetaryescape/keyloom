// Native shell around the unchanged `keyloom serve`: runs (or attaches to) the server, shows its page in a window, and puts the
// sync line in the menu bar. No product logic lives here (chapter 26); the server words every string about keyboards. When there is
// no server to show, the shell's problem window says why and offers the way out (problem.rs).
mod external;
mod log;
mod login_path;
mod menu_bar;
mod problem;
mod restarts;
mod sidecar;
#[cfg(feature = "updater")]
mod updates;

use restarts::{Quit, Restarts};
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_notification::NotificationExt;

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
    /// The last lines the running server wrote, for the problem window when it keeps stopping (R3-16).
    pub server_tail: Mutex<std::collections::VecDeque<String>>,
    pub retry: tokio::sync::Notify,
    /// Signalled when the person picks the item that replaces an incompatible server (offered only when the CLI offers it).
    pub replace: tokio::sync::Notify,
    /// Why there is no server, while the supervisor waits for Try again or replace; the first click takes it (problem::act).
    pub problem: Mutex<Option<problem::Stop>>,
    /// Set when the server this shell started exited because the page or the menu bar asked for a restart (sidecar::RESTART_EXIT_CODE).
    pub restart_asked: std::sync::atomic::AtomicBool,
    pub updates: Mutex<problem::Updates>,
    /// Set when the app is quitting, so the supervisor doesn't start the server it is stopping.
    pub quit: Quit,
    #[cfg(feature = "updater")]
    pub install_update: tokio::sync::Notify,
    #[cfg(feature = "updater")]
    pub check_updates: tokio::sync::Notify,
    /// Stop download, in the menu bar or the problem window, while an update downloads (R4-06).
    #[cfg(feature = "updater")]
    pub stop_update: tokio::sync::Notify,
    #[cfg(feature = "updater")]
    pub update_offered: std::sync::atomic::AtomicBool,
}

// Open keyloom, the Dock icon and a second launch bring forward the page, or the problem window while there is no page to show.
pub(crate) fn show_window(app: &AppHandle) {
    if !problem::bring_forward_problem(app) {
        problem::bring_forward(app, "main");
    }
}

pub fn navigate(app: &AppHandle, url: &str) {
    if let (Some(w), Ok(url)) = (app.get_webview_window("main"), url.parse()) {
        let _ = w.navigate(url);
    }
}

// Shows the server's page: opens the window the first time, and points it at the new server after a restart. `reveal` brings back a
// window that is hidden; an automatic restart passes false, so a window the person closed stays closed.
fn present_main(app: &AppHandle, url: &str, reveal: bool) {
    let (handle, url) = (app.clone(), url.to_string());
    // Window creation must happen on the main thread.
    let _ = app.run_on_main_thread(move || {
        let Ok(parsed) = url.parse() else { return };
        if let Some(w) = handle.get_webview_window("main") {
            let _ = w.navigate(parsed);
            if reveal {
                let _ = w.show();
            }
            return;
        }
        // Links to other sites open in the browser and downloads land in Downloads; without these the page's links did nothing (R4-01).
        let built = external::attach(&handle, WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(parsed)))
            // Tauri's own drag-and-drop handler takes every drag for Tauri drag events, which nothing here listens to, so a file dropped
            // on the import card and a dragged layer tab never reached the page (R5-01). Without it WKWebView gives the page its drags.
            .disable_drag_drop_handler()
            .title("keyloom")
            .inner_size(1440.0, 900.0)
            .min_inner_size(900.0, 600.0)
            .build();
        if let Err(err) = built {
            log::say(&handle, &format!("window failed: {err}"));
        }
    });
}

fn hide_main(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = handle.get_webview_window("main") {
            let _ = w.hide();
        }
    });
}

/// Starts the server, shows it, and watches it. A server that goes away is started again the same way, with a back-off and a cap
/// (restarts.rs). When there is none to show, opens the problem window and waits for the person to pick Try again (or the CLI's
/// replace offer) in it or in the menu bar, then starts again.
async fn supervise(app: AppHandle, tray: TrayIcon, items: menu_bar::Items) {
    // macOS shows a notification only after the user has allowed it; this asks on first launch.
    if let Err(err) = app.notification().request_permission() {
        log::say(&app, &format!("notification permission failed: {err}"));
    }
    let state = app.state::<AppState>();
    let mut mode = sidecar::Mode::Reuse;
    let mut restarts = Restarts::default();
    // False only after an automatic restart: the window keeps whatever the person left it as.
    let mut reveal = true;
    loop {
        // Quitting stops the server on purpose; starting it again would undo that.
        if state.quit.is_set() {
            return;
        }
        let stop = match sidecar::start(&app, mode).await {
            Ok(server) => {
                let url = server.url.clone();
                menu_bar::offer_restart(&items, server.owned);
                *state.server.lock().unwrap() = Some(server);
                problem::close(&app);
                present_main(&app, &url, reveal);
                menu_bar::watch(&app, &tray, &items).await;
                if state.quit.is_set() {
                    return;
                }
                // A restart the person asked for is not a stop: it starts again at once and doesn't count toward the cap (R5-15).
                if state.restart_asked.swap(false, std::sync::atomic::Ordering::AcqRel) {
                    log::say(&app, "keyloom's server stopped to restart, as asked; starting it again");
                    let _ = items.summary.set_text("Restarting keyloom…");
                    mode = sidecar::Mode::Reuse;
                    reveal = false;
                    continue;
                }
                match restarts.next(std::time::Instant::now()) {
                    Some(delay) => {
                        log::say(&app, &format!("keyloom's server is gone; starting it again in {} s", delay.as_secs()));
                        let _ = items.summary.set_text("keyloom stopped. Starting it again…");
                        if !state.quit.wait(delay).await {
                            return;
                        }
                        mode = sidecar::Mode::Reuse;
                        reveal = false;
                        continue;
                    }
                    None => problem::Stop::KeepsStopping { times: restarts.stops(), output: sidecar::last_output(&app) },
                }
            }
            Err(failure) => problem::Stop::Failed(failure),
        };
        log::say(&app, &stop.to_string());
        hide_main(&app);
        let _ = items.summary.set_text(stop.title());
        let _ = items.sync_now.set_enabled(false);
        menu_bar::offer_restart(&items, false);
        // The menu-bar way back, beside the window's: the window can be closed, the menu bar stays.
        let mut added = Vec::new();
        if let Some(label) = stop.replace_label() {
            added.extend(MenuItem::with_id(&app, problem::REPLACE, label, true, None::<&str>).ok());
        }
        if stop.can_retry() {
            added.extend(MenuItem::with_id(&app, problem::TRY_AGAIN, "Try starting keyloom again", true, None::<&str>).ok());
        }
        for item in &added {
            let _ = items.menu.insert(item, 1);
        }
        // A newer keyloom is in the way: the fix is a newer app, so look for one now rather than at the next six-hourly check.
        #[cfg(feature = "updater")]
        {
            if stop.wants_update() {
                updates::check_now(&app);
            }
        }
        problem::open(&app, stop);
        mode = tokio::select! {
            _ = state.retry.notified() => sidecar::Mode::Reuse,
            _ = state.replace.notified() => sidecar::Mode::Replace,
        };
        for item in &added {
            let _ = items.menu.remove(item);
        }
        let _ = items.summary.set_text("Starting");
        // The person chose to try again, so earlier stops no longer count toward the cap, and the page they asked for comes back.
        restarts = Restarts::default();
        reveal = true;
    }
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
            log::rotate(&handle);

            let summary = MenuItem::with_id(&handle, "summary", "Starting", false, None::<&str>)?;
            let sync_now = MenuItem::with_id(&handle, "sync_now", "Sync now", false, None::<&str>)?;
            let open = MenuItem::with_id(&handle, "open", "Open keyloom", true, None::<&str>)?;
            let restart = MenuItem::with_id(&handle, menu_bar::RESTART, menu_bar::RESTART_LABEL, false, None::<&str>)?;
            #[cfg(feature = "updater")]
            let update = MenuItem::with_id(&handle, "update", "Checking for updates…", false, None::<&str>)?;
            // Off until BK turns it on: nothing registers a login item by itself.
            let login = CheckMenuItem::with_id(&handle, "login", "Launch at login", true, handle.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
            let quit = MenuItem::with_id(&handle, "quit", "Quit keyloom", true, Some("CmdOrCtrl+Q"))?;
            #[cfg(feature = "updater")]
            let menu = Menu::with_items(
                &handle,
                &[
                    &summary,
                    &menu_bar::separator(&handle)?,
                    &sync_now,
                    &open,
                    &restart,
                    &update,
                    &login,
                    &menu_bar::separator(&handle)?,
                    &quit,
                ],
            )?;
            #[cfg(not(feature = "updater"))]
            let menu = Menu::with_items(
                &handle,
                &[&summary, &menu_bar::separator(&handle)?, &sync_now, &open, &restart, &login, &menu_bar::separator(&handle)?, &quit],
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
                        menu_bar::RESTART => menu_bar::restart(app),
                        id @ (problem::REPLACE | problem::TRY_AGAIN | problem::DOWNLOAD | problem::STOP_DOWNLOAD) => problem::act(app, id),
                        #[cfg(feature = "updater")]
                        "update" => updates::menu_item(app),
                        "login" => {
                            let manager = app.autolaunch();
                            let result = if manager.is_enabled().unwrap_or(false) { manager.disable() } else { manager.enable() };
                            if let Err(err) = result {
                                log::say(app, &format!("launch at login failed: {err}"));
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
            tauri::async_runtime::spawn(updates::watch(handle.clone(), menu.clone(), update.clone()));

            // Everything that waits on the server runs off the setup thread so the menu-bar extra shows at once.
            let items = menu_bar::Items { menu, summary, sync_now, restart, lines: Mutex::new(Vec::new()) };
            tauri::async_runtime::spawn(supervise(handle, tray, items));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing a window keeps the menu-bar extra and its watcher alive; Quit (menu bar or Cmd+Q) ends the app.
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
