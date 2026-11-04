# Verify the desktop installation

Check the installed app, its published archive and the running server separately.
These steps read the installation and download a comparison archive into a scratch
directory. They do not replace or launch the app, change a config or access a
keyboard. Use macOS with `gh` authenticated to download release assets.

## Read the installed versions

Keep this shell open for the remaining steps. Change `app` if you installed the
bundle elsewhere:

```sh
app="/Applications/keyloom.app"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
printf 'App on disk: %s\n' "$version"
"$app/Contents/MacOS/keyloom" --version
command -v keyloom || true
```

The first two versions describe the app bundle and a fresh invocation of its
sidecar. Neither identifies the already-running process. `command -v` identifies
the separate CLI on PATH, if any; `install.sh` updates that CLI, not the desktop
app. Setting `KEYLOOM_INSTALL_DIR` to a scratch directory verifies only that scratch
installation.

## Check macOS trust

Verify the signature and ask Gatekeeper to assess the installed bundle:

```sh
codesign --verify --deep --strict --verbose=2 "$app"
spctl --assess --type execute --verbose=2 "$app"
```

For the verified v0.67.0 release, the results included `valid on disk`, `accepted`
and `source=Notarized Developer ID`. A failure is a reason to inspect that artifact
and its release notes. Do not remove quarantine attributes or weaken Gatekeeper
to make the check pass. Passing these checks does not prove the app launched or
that the embedded helper has been exercised.

## Download the matching desktop artifact

Use the app's version, not the moving latest-release URL:

```sh
tag="v$version"
archive="keyloom-$version-darwin-arm64.app.zip"
work="$(mktemp -d "${TMPDIR:-/tmp}/keyloom-desktop-verify.XXXXXX")"
gh release download "$tag" --repo planetaryescape/keyloom \
  --pattern "$archive" --pattern "$archive.sha256" --dir "$work"
(
  cd "$work"
  shasum -a 256 -c "$archive.sha256"
)
ditto -x -k "$work/$archive" "$work/unpacked"
```

Expect the archive name followed by `OK`. Stop if the checksum fails. These asset
names describe the published Apple Silicon desktop app; Intel CLI support does
not imply a published Intel app bundle. A local preview version may have no
matching public release.

## Compare the final packaged app

Compare the installed files with the extracted desktop archive:

```sh
diff -rq "$app/Contents" "$work/unpacked/keyloom.app/Contents"
```

No output and exit 0 means the compared file contents match. This is not a check
of all filesystem metadata or running memory. If the updater replaced the app
during inspection, repeat from the version read before diagnosing the difference.

Do not compare the bundled sidecar's hash with the standalone CLI entry in
`SHA256SUMS`. The workflow copies that CLI into the desktop build, then Tauri signs
it with the bundle. The final bytes can differ. The desktop ZIP's `.sha256` checks
the correct artifact stage. In the v0.67.0 check, the installed app matched all six
files in the extracted desktop bundle even though its sidecar hash differed from
the standalone CLI hash.

## Check the running server separately

Read only the non-secret fields from the server's startup record. The record's
`url` contains a session token, so avoid pasting the whole file into logs or reports:

```sh
python3 - <<'PY'
import json, os, pathlib, subprocess
base = pathlib.Path(os.environ.get("XDG_DATA_HOME", pathlib.Path.home() / ".local/share"))
record = base / "keyloom/serve.json"
if not record.exists():
    print("No server startup record at", record)
else:
    data = json.loads(record.read_text())
    print(json.dumps({key: data.get(key) for key in ("pid", "startedAt", "version", "protocol")}, indent=2))
    pid = data.get("pid")
    if type(pid) is int and pid > 1:
        subprocess.run(["ps", "-p", str(pid), "-o", "pid=,lstart=,command="], check=False)
PY
```

For a custom `--data-dir`, point `record` at that directory's `serve.json`.
The record reports the version at server startup; a leftover record by itself is
not proof of a live server. The process listing helps check the PID, but a recycled
PID still needs the app's normal live-server probe. A fresh `--version` invocation
cannot answer which executable is already serving the app.

Choosing the app's own install-and-restart action restarts keyloom after the update
installs (D-481). If the bundle was replaced some other way while the app was running,
finish pending work, use **Quit keyloom** or Cmd-Q, then reopen it and check the
startup identity again. Closing the window
only hides it. Normal Quit asks an owned server to stop gracefully and waits up
to 30 seconds; avoid force-quitting during a keyboard write. A server started
elsewhere can be reused and is not stopped by quitting the shell. Inspect the
app's compatibility/replacement message rather than assuming a restart replaced
that server. Do not run `sync` or `flash` to verify an app update.

See [desktop packaging and updater setup](../desktop/tauri/README.md) and
[the desktop architecture](blueprint/26-desktop-app.md) for the source contracts.
