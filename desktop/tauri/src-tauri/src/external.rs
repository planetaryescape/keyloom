// Links and downloads from keyloom's page (R4-01). WKWebView, through wry, refuses both unless the shell says what to do: a link
// that opens a new window (`target="_blank"`, every external link in the page) and any download were dropped without a word.
// External web pages open in the person's browser, the page itself stays in the window, and a download is saved to Downloads and
// shown in Finder. The routing is pure, so every case is a table test; `attach` wires it to the main window.
use crate::{log, AppState};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Manager, Url, WebviewWindowBuilder, Wry,
};

/// Where a link or a navigation goes.
#[derive(Debug, PartialEq)]
pub enum Route {
    /// keyloom's own page, or something inside it (a `blob:` file, `about:blank`): the window loads it.
    Stay,
    /// A web page somewhere else: the default browser opens it, and the window keeps keyloom.
    Browser,
    /// Anything else (`file:`, a custom scheme): nothing opens it.
    Block,
}

fn is_loopback(url: &Url) -> bool {
    matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
}

/// A link that asks for a new window. The window never opens one: keyloom has one page, so a web page goes to the browser.
pub fn new_window_route(target: &Url) -> Route {
    if matches!(target.scheme(), "http" | "https") {
        Route::Browser
    } else {
        Route::Block
    }
}

/// A navigation in the main window. `own` is the server's origin; with none recorded (between servers), any loopback page counts
/// as keyloom's, so a restart's new port still loads.
pub fn navigation_route(target: &Url, own: Option<&Url>) -> Route {
    match target.scheme() {
        "about" | "blob" => Route::Stay,
        "http" | "https" => {
            let ours = match own {
                Some(own) => own.origin() == target.origin(),
                None => is_loopback(target),
            };
            if ours {
                Route::Stay
            } else {
                Route::Browser
            }
        }
        _ => Route::Block,
    }
}

/// Where a download is saved: `suggested`'s file name in `dir`, never over a file that is there. A taken name gets " (1)", " (2)"…
/// before its first dot, as wry numbers the path it suggests, so the two never disagree. A name with no file part (".." or empty) is
/// saved as "download".
pub fn unused_path(dir: &Path, suggested: &Path) -> PathBuf {
    let name = suggested.file_name().and_then(|n| n.to_str()).filter(|n| !n.is_empty()).unwrap_or("download");
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    // A leading dot (".env") belongs to the stem; the extension starts at the first dot after it.
    let split = name.char_indices().skip(1).find(|(_, c)| *c == '.').map(|(i, _)| i).unwrap_or(name.len());
    let (stem, ext) = name.split_at(split);
    (1..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).expect("some number is free")
}

/// Downloads in flight, by URL: macOS doesn't say where a finished download was saved, so the shell keeps what it chose.
#[derive(Default)]
pub struct Downloads(Mutex<HashMap<String, PathBuf>>);

impl Downloads {
    fn start(&self, url: &Url, path: PathBuf) {
        self.0.lock().unwrap().insert(url.to_string(), path);
    }

    fn finish(&self, url: &Url) -> Option<PathBuf> {
        self.0.lock().unwrap().remove(url.as_str())
    }
}

/// What the shell tells the person when a download didn't save. A saved one is shown in Finder instead, which says it plainly.
pub fn failed_notice(path: Option<&Path>) -> (String, String) {
    let name = path.and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned());
    let body = match name {
        Some(name) => format!("{name} wasn't saved. Choose the download in keyloom again."),
        None => "The file wasn't saved. Choose the download in keyloom again.".into(),
    };
    ("keyloom couldn't save the download".into(), body)
}

fn own_origin(app: &AppHandle) -> Option<Url> {
    app.state::<AppState>().server.lock().unwrap().as_ref().and_then(|s| s.origin.parse().ok())
}

fn open_in_browser(app: &AppHandle, url: &Url) {
    log::say(app, &format!("opening {} in the browser", url.origin().ascii_serialization()));
    log::open_external(app, std::ffi::OsStr::new(url.as_str()));
}

/// Gives the main window its link, navigation and download handlers.
pub fn attach<'a>(app: &AppHandle, builder: WebviewWindowBuilder<'a, Wry, AppHandle>) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    let (links, pages, saves) = (app.clone(), app.clone(), app.clone());
    let downloads = Arc::new(Downloads::default());
    builder
        .on_new_window(move |url, _| {
            match new_window_route(&url) {
                Route::Browser => open_in_browser(&links, &url),
                _ => log::say(&links, &format!("refused to open a {} link", url.scheme())),
            }
            NewWindowResponse::Deny
        })
        .on_navigation(move |url| match navigation_route(url, own_origin(&pages).as_ref()) {
            Route::Stay => true,
            Route::Browser => {
                open_in_browser(&pages, url);
                false
            }
            Route::Block => {
                log::say(&pages, &format!("refused to load a {} page", url.scheme()));
                false
            }
        })
        .on_download(move |_, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let Ok(dir) = saves.path().download_dir() else {
                        log::say(&saves, "refused a download: no Downloads folder");
                        return false;
                    };
                    *destination = unused_path(&dir, destination);
                    downloads.start(&url, destination.clone());
                    true
                }
                DownloadEvent::Finished { url, path, success } => {
                    let kept = downloads.finish(&url);
                    let saved = path.or(kept);
                    match (&saved, success) {
                        (Some(file), true) => {
                            log::say(&saves, "download saved");
                            // Finder selects the saved file, so the person sees where it went without a download shelf.
                            log::reveal(&saves, file);
                        }
                        _ => {
                            log::say(&saves, "download failed");
                            let (title, body) = failed_notice(saved.as_deref());
                            crate::menu_bar::notify(&saves, &title, &body);
                        }
                    }
                    true
                }
                _ => true,
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn a_new_window_link_opens_web_pages_in_the_browser_and_nothing_else() {
        assert_eq!(new_window_route(&url("https://docs.docker.com/desktop/")), Route::Browser);
        assert_eq!(new_window_route(&url("http://example.com/")), Route::Browser);
        assert_eq!(new_window_route(&url("file:///etc/passwd")), Route::Block);
        assert_eq!(new_window_route(&url("keyloom-desktop://try-again")), Route::Block);
        assert_eq!(new_window_route(&url("javascript:alert(1)")), Route::Block);
    }

    #[test]
    fn the_window_keeps_keyloom_and_sends_other_sites_to_the_browser() {
        let own = url("http://127.0.0.1:4477");
        assert_eq!(navigation_route(&url("http://127.0.0.1:4477/?t=abc"), Some(&own)), Route::Stay);
        assert_eq!(navigation_route(&url("http://127.0.0.1:4477/layouts/x"), Some(&own)), Route::Stay);
        assert_eq!(navigation_route(&url("https://github.com/planetaryescape/keyloom"), Some(&own)), Route::Browser);
        // Another port is another server, not this page.
        assert_eq!(navigation_route(&url("http://127.0.0.1:9999/"), Some(&own)), Route::Browser);
        assert_eq!(navigation_route(&url("blob:http://127.0.0.1:4477/1b2c"), Some(&own)), Route::Stay);
        assert_eq!(navigation_route(&url("about:blank"), Some(&own)), Route::Stay);
        assert_eq!(navigation_route(&url("file:///Users/x/secret"), Some(&own)), Route::Block);
    }

    #[test]
    fn between_servers_a_loopback_page_still_loads() {
        assert_eq!(navigation_route(&url("http://127.0.0.1:5000/?t=abc"), None), Route::Stay);
        assert_eq!(navigation_route(&url("http://localhost:5000/"), None), Route::Stay);
        assert_eq!(navigation_route(&url("https://example.com/"), None), Route::Browser);
    }

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("keyloom-downloads-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_download_never_replaces_a_file_that_is_there() {
        let dir = scratch();
        let name = Path::new("keyloom-board-contribution.zip");
        assert_eq!(unused_path(&dir, name), dir.join("keyloom-board-contribution.zip"));
        std::fs::write(dir.join("keyloom-board-contribution.zip"), "first").unwrap();
        assert_eq!(unused_path(&dir, name), dir.join("keyloom-board-contribution (1).zip"));
        std::fs::write(dir.join("keyloom-board-contribution (1).zip"), "second").unwrap();
        assert_eq!(unused_path(&dir, name), dir.join("keyloom-board-contribution (2).zip"));
        // wry hands over a name it has already numbered; a free one is kept as it is.
        assert_eq!(unused_path(&dir, Path::new("keyloom-board-contribution (2).zip")), dir.join("keyloom-board-contribution (2).zip"));
        assert_eq!(std::fs::read_to_string(dir.join("keyloom-board-contribution.zip")).unwrap(), "first");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_download_name_stays_inside_the_folder() {
        let dir = scratch();
        // WebKit hands a full path in Downloads; only its file name is kept.
        assert_eq!(unused_path(&dir, Path::new("/Users/x/Downloads/firmware.uf2")), dir.join("firmware.uf2"));
        assert_eq!(unused_path(&dir, Path::new("../../etc/firmware.bin")), dir.join("firmware.bin"));
        assert_eq!(unused_path(&dir, Path::new("..")), dir.join("download"));
        assert_eq!(unused_path(&dir, Path::new("")), dir.join("download"));
        std::fs::write(dir.join(".keymap"), "").unwrap();
        assert_eq!(unused_path(&dir, Path::new(".keymap")), dir.join(".keymap (1)"));
        std::fs::write(dir.join("a.tar.gz"), "").unwrap();
        assert_eq!(unused_path(&dir, Path::new("a.tar.gz")), dir.join("a (1).tar.gz"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_finished_download_is_found_by_its_url() {
        let downloads = Downloads::default();
        let blob = url("blob:http://127.0.0.1:4477/1b2c");
        downloads.start(&blob, PathBuf::from("/d/firmware.bin"));
        assert_eq!(downloads.finish(&url("blob:http://127.0.0.1:4477/other")), None);
        assert_eq!(downloads.finish(&blob), Some(PathBuf::from("/d/firmware.bin")));
        assert_eq!(downloads.finish(&blob), None, "forgotten once finished");
    }

    #[test]
    fn a_failed_download_says_which_file_and_what_to_do() {
        let (title, body) = failed_notice(Some(Path::new("/d/firmware.bin")));
        assert_eq!(title, "keyloom couldn't save the download");
        assert_eq!(body, "firmware.bin wasn't saved. Choose the download in keyloom again.");
        assert!(failed_notice(None).1.starts_with("The file wasn't saved."));
    }
}
