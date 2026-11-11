// The shell's own log, so the problem window's Show log has something to open: an app started from Finder has no terminal, and its
// stderr goes nowhere. One file in ~/Library/Logs/<identifier>/, kept small by moving it aside at launch once it passes a limit.
use std::io::Write;
use tauri::{AppHandle, Manager};

const FILE: &str = "keyloom.log";
const KEEP_BYTES: u64 = 1024 * 1024;

pub fn path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_log_dir().ok().map(|d| d.join(FILE))
}

/// Run once at launch: a log past the limit becomes keyloom.log.old, replacing the one before.
pub fn rotate(app: &AppHandle) {
    let Some(file) = path(app) else { return };
    if std::fs::metadata(&file).map(|m| m.len() > KEEP_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(&file, file.with_extension("log.old"));
    }
}

/// Writes one line to stderr and to the log. Callers keep secrets out: the server's URL line carries its session token.
pub fn say(app: &AppHandle, line: &str) {
    eprintln!("keyloom-desktop: {line}");
    let Some(file) = path(app) else { return };
    let _ = std::fs::create_dir_all(file.parent().expect("a file path has a parent"));
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&file) {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "[{secs}] {line}");
    }
}

/// The server's own output, line by line, minus anything that carries its token.
pub fn server_output(app: &AppHandle, text: &str) {
    for line in text.lines().filter(|l| !l.trim().is_empty() && !carries_token(l)) {
        say(app, &format!("keyloom: {line}"));
    }
}

pub fn carries_token(line: &str) -> bool {
    line.contains("?t=") || line.contains("&t=")
}

/// Opens the log in the person's default app for .log files (Console on a Mac), creating it if nothing was written yet.
pub fn show(app: &AppHandle) {
    let Some(file) = path(app) else { return };
    if !file.exists() {
        say(app, "log opened");
    }
    open_external(app, file.as_os_str());
}

/// Hands a file or URL to macOS's `open`: a .log opens in Console, a URL in the default browser.
pub fn open_external(app: &AppHandle, target: &std::ffi::OsStr) {
    match std::process::Command::new("/usr/bin/open").arg(target).spawn() {
        Ok(child) => {
            reap(child);
        }
        Err(err) => say(app, &format!("could not open {}: {err}", target.to_string_lossy())),
    }
}

// `open` hands the target over and exits at once. Waiting on it, off the main thread, reaps it, so each click doesn't leave a zombie.
fn reap(mut child: std::process::Child) -> std::thread::JoinHandle<std::io::Result<std::process::ExitStatus>> {
    std::thread::spawn(move || child.wait())
}

#[cfg(test)]
mod tests {
    use super::{carries_token, reap};

    #[test]
    fn an_opened_helper_is_reaped_not_left_a_zombie() {
        let child = std::process::Command::new("/usr/bin/true").spawn().expect("true runs");
        let pid = child.id() as libc::pid_t;
        assert!(reap(child).join().expect("the thread ends").expect("waited").success());
        // A reaped child is gone from the process table: waitpid no longer knows it.
        assert_eq!(unsafe { libc::waitpid(pid, std::ptr::null_mut(), libc::WNOHANG) }, -1);
    }

    #[test]
    fn the_url_line_never_reaches_the_log() {
        assert!(carries_token("keyloom is running at http://127.0.0.1:4477/?t=abc"));
        assert!(carries_token("open http://127.0.0.1:1/x?a=1&t=abc"));
        assert!(!carries_token("error: the data directory is newer than this keyloom"));
    }
}
