// An app opened from Finder or the Dock gets launchd's minimal PATH (/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin), not the one
// the person's shell builds, so the bundled `keyloom serve` couldn't find codex, docker or zapp in /opt/homebrew/bin (D-441).
// This asks the login shell for its PATH, the one a terminal sees. tauri-apps/fix-path-env-rs does the same, but it isn't on
// crates.io and waits on the shell with no deadline, so a slow shell profile would hang the app at launch.
// The model providers' settings come the same way, so a key exported in a shell profile reaches chat (D-443).
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// What keyloom and the Codex CLI it starts read from the environment for chat. Nothing else is taken from the shell.
pub const PROVIDER_ENV: [&str; 7] = [
    "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "CODEX_API_KEY", "CODEX_HOME", "KEYLOOM_CODEX_BIN", "KEYLOOM_CODEX_TRACE", "KEYLOOM_PROVIDER",
];
const DEADLINE: Duration = Duration::from_secs(3);
const HOMEBREW: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];
// A shell profile that prints without end would otherwise grow the buffer until the deadline.
const MAX_OUTPUT: usize = 1 << 20;

pub struct LoginEnvironment {
    pub path: String,
    /// Allowlisted provider settings the shell sets and the app's own environment doesn't.
    pub variables: Vec<(String, String)>,
}

/// The login shell's PATH followed by any inherited folders it lacks, plus its provider settings; or the inherited PATH with
/// Homebrew's folders added and no settings when the shell doesn't answer within the deadline.
pub fn resolve() -> LoginEnvironment {
    let inherited = std::env::var("PATH").unwrap_or_default();
    match from_login_shell() {
        Some(env) => LoginEnvironment {
            path: merged(&env.path, &inherited),
            variables: env.variables.into_iter().filter(|(name, _)| std::env::var_os(name).is_none()).collect(),
        },
        None => LoginEnvironment { path: merged(&HOMEBREW.join(":"), &inherited), variables: Vec::new() },
    }
}

fn from_login_shell() -> Option<LoginEnvironment> {
    let shell = std::env::var("SHELL").ok().filter(|s| s.starts_with('/')).unwrap_or_else(|| "/bin/zsh".into());
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    // Unique per run, so nothing a profile printed earlier can pass for the answer.
    let mark = format!("__KEYLOOM_PATH_{}_{nanos}__", std::process::id());
    // External commands only and `;` between them, so sh, zsh, bash, fish and nushell all read it the same way; nushell
    // would print "$PATH" literally, and has no `||` to excuse a printenv of an unset name.
    let script = format!("/bin/echo {mark}; /usr/bin/env; /bin/echo {mark}");
    let child = Command::new(shell)
        .args(["-ilc", &script])
        // Oh My Zsh can stop to ask about updating.
        .env("DISABLE_AUTO_UPDATE", "true")
        .current_dir(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    collect(child, &mark, DEADLINE)
}

/// Reads the child's stdout until the text between two `mark`s arrives or `deadline` passes, then stops the child.
fn collect(mut child: Child, mark: &str, deadline: Duration) -> Option<LoginEnvironment> {
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    let reader_mark = mark.to_owned();
    // Reads until the closing mark rather than end of file: a profile can start a background process that keeps the pipe
    // open after the shell exits. If that reader never finishes, the thread is left behind, not the app.
    std::thread::spawn(move || {
        let mut out = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&chunk[..n]),
            }
            if between_marks(&String::from_utf8_lossy(&out), &reader_mark).is_some() || out.len() > MAX_OUTPUT {
                break;
            }
        }
        let _ = tx.send(between_marks(&String::from_utf8_lossy(&out), &reader_mark).and_then(|env| parse_env(&env)));
    });
    let path = rx.recv_timeout(deadline).ok().flatten();
    // The answer is in, or it is too late: either way the shell has nothing more to give.
    let _ = child.kill();
    let _ = child.wait();
    path
}

fn between_marks(out: &str, mark: &str) -> Option<String> {
    let mut parts = out.split(mark);
    parts.next()?;
    let env = parts.next()?;
    parts.next()?;
    Some(env.to_owned())
}

/// PATH and the allowlisted settings from `env` output; every other variable is dropped here.
fn parse_env(env: &str) -> Option<LoginEnvironment> {
    let mut path = None;
    let mut variables: Vec<(String, String)> = Vec::new();
    for line in env.lines() {
        let Some((name, value)) = line.split_once('=') else { continue };
        if value.is_empty() {
            continue;
        }
        if name == "PATH" {
            path.get_or_insert_with(|| value.to_owned());
        } else if PROVIDER_ENV.contains(&name) && !variables.iter().any(|(n, _)| n == name) {
            variables.push((name.to_owned(), value.to_owned()));
        }
    }
    // A shell that couldn't run env leaves nothing, or a PATH that isn't a list of folders.
    let path = path.filter(|p| p.split(':').any(|d| d.starts_with('/')))?;
    Some(LoginEnvironment { path, variables })
}

/// `first`'s folders in order, then any of `then`'s it lacks, so the result never loses a folder the app could already search.
fn merged(first: &str, then: &str) -> String {
    let mut dirs: Vec<&str> = Vec::new();
    for dir in first.split(':').chain(then.split(':')) {
        if !dir.is_empty() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    const M: &str = "__KEYLOOM_PATH_1_2__";

    #[test]
    fn takes_the_marked_env_from_noisy_profile_output() {
        let out = format!("Welcome!\n{M}\nHOME=/Users/x\nPATH=/opt/homebrew/bin:/usr/bin\n{M}\nbye\n");
        let env = between_marks(&out, M).and_then(|e| parse_env(&e)).unwrap();
        assert_eq!(env.path, "/opt/homebrew/bin:/usr/bin");
        assert!(env.variables.is_empty());
    }

    #[test]
    fn refuses_output_without_both_marks_or_without_folders() {
        assert!(between_marks("no marks", M).is_none());
        assert!(between_marks(&format!("{M}\nPATH=/usr/bin\n"), M).is_none());
        assert!(parse_env("HOME=/x\n").is_none());
        assert!(parse_env("PATH=$PATH\n").is_none());
    }

    #[test]
    fn a_mark_printed_by_an_earlier_run_is_not_this_runs_answer() {
        let out = "__KEYLOOM_PATH_9_9__\nPATH=/tmp/forged\n__KEYLOOM_PATH_9_9__\n";
        assert!(between_marks(out, M).is_none());
    }

    #[test]
    fn takes_only_allowlisted_provider_settings_that_are_set() {
        let env = parse_env("PATH=/usr/bin\nANTHROPIC_API_KEY=sk-a\nOPENROUTER_API_KEY=\nAWS_SECRET_ACCESS_KEY=nope\nKEYLOOM_PROVIDER=codex\nANTHROPIC_API_KEY=second\n").unwrap();
        assert_eq!(env.variables, vec![("ANTHROPIC_API_KEY".to_owned(), "sk-a".to_owned()), ("KEYLOOM_PROVIDER".to_owned(), "codex".to_owned())]);
    }

    #[test]
    fn a_value_containing_equals_signs_is_kept_whole() {
        let env = parse_env("PATH=/usr/bin\nCODEX_API_KEY=a=b=c\n").unwrap();
        assert_eq!(env.variables, vec![("CODEX_API_KEY".to_owned(), "a=b=c".to_owned())]);
    }

    #[test]
    fn keeps_every_inherited_folder_after_the_shells_own() {
        assert_eq!(merged("/opt/homebrew/bin:/usr/bin", "/usr/local/bin:/usr/bin:/bin"), "/opt/homebrew/bin:/usr/bin:/usr/local/bin:/bin");
        assert_eq!(merged(&HOMEBREW.join(":"), ""), "/opt/homebrew/bin:/usr/local/bin");
    }

    fn shell(script: &str) -> Child {
        Command::new("/bin/sh").args(["-c", script]).stdin(Stdio::null()).stdout(Stdio::piped()).spawn().unwrap()
    }

    #[test]
    fn a_background_process_holding_the_pipe_does_not_hold_up_the_answer() {
        let started = std::time::Instant::now();
        let child = shell(&format!("sleep 30 & /bin/echo {M}; /usr/bin/env; /bin/echo {M}"));
        assert!(collect(child, M, DEADLINE).is_some_and(|env| !env.path.is_empty()));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_shell_that_never_answers_is_given_up_on_at_the_deadline() {
        let started = std::time::Instant::now();
        assert!(collect(shell(&format!("/bin/echo {M}; sleep 30")), M, Duration::from_millis(300)).is_none());
        let waited = started.elapsed();
        assert!(waited >= Duration::from_millis(300) && waited < Duration::from_secs(2), "{waited:?}");
    }
}
