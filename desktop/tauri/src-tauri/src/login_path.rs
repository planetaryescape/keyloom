// An app opened from Finder or the Dock gets launchd's minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), not the one the person's
// shell builds, so the bundled `keyloom serve` couldn't find codex, docker or zapp in /opt/homebrew/bin. This asks the login
// shell for its PATH, the one a terminal sees. tauri-apps/fix-path-env-rs does the same, but it isn't on crates.io and waits on
// the shell with no deadline, so a slow shell profile would hang the app at launch.
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const MARK: &str = "__KEYLOOM_PATH__";
const DEADLINE: Duration = Duration::from_secs(3);
const HOMEBREW: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];

/// The login shell's PATH, or the inherited one with Homebrew's folders added when the shell doesn't answer in time.
pub fn resolve() -> String {
    from_login_shell().unwrap_or_else(|| with_homebrew(&std::env::var("PATH").unwrap_or_default()))
}

fn from_login_shell() -> Option<String> {
    let shell = std::env::var("SHELL").ok().filter(|s| s.starts_with('/')).unwrap_or_else(|| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-ilc", &format!("printf '%s%s%s' {MARK} \"$PATH\" {MARK}")])
        // Oh My Zsh can stop to ask about updating.
        .env("DISABLE_AUTO_UPDATE", "true")
        .current_dir(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < DEADLINE => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    between_marks(&out)
}

// A shell profile may print its own output around the marked value.
fn between_marks(out: &str) -> Option<String> {
    let mut parts = out.split(MARK);
    parts.next()?;
    let path = parts.next()?;
    parts.next()?;
    (!path.is_empty()).then(|| path.to_owned())
}

fn with_homebrew(path: &str) -> String {
    let mut dirs: Vec<&str> = path.split(':').filter(|d| !d.is_empty()).collect();
    for dir in HOMEBREW.iter().rev() {
        if !dirs.contains(dir) {
            dirs.insert(0, dir);
        }
    }
    dirs.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_marked_path_from_noisy_profile_output() {
        let out = format!("Welcome!\n{MARK}/opt/homebrew/bin:/usr/bin{MARK}bye\n");
        assert_eq!(between_marks(&out).as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
    }

    #[test]
    fn refuses_output_without_both_marks_or_with_an_empty_path() {
        assert_eq!(between_marks("no marks"), None);
        assert_eq!(between_marks(&format!("{MARK}/usr/bin")), None);
        assert_eq!(between_marks(&format!("{MARK}{MARK}")), None);
    }

    #[test]
    fn adds_missing_homebrew_folders_ahead_of_the_inherited_path() {
        assert_eq!(with_homebrew("/usr/bin:/bin"), "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
        assert_eq!(with_homebrew("/usr/local/bin:/usr/bin"), "/opt/homebrew/bin:/usr/local/bin:/usr/bin");
        assert_eq!(with_homebrew(""), "/opt/homebrew/bin:/usr/local/bin");
    }
}
