# The desktop app can't find codex, docker or zapp

BK's installed 0.53.1 app showed "Chat needs a model" when he pressed Cmd+K, although `keyloom provider` in his terminal reported Codex as ready. The app's processes ran with launchd's PATH:

```
18828 /Applications/keyloom.app/Contents/MacOS/keyloom-desktop     PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
19063 …/MacOS/keyloom serve --port 55231 --no-open --exit-on-stdin-close --reuse   PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

`codex`, `docker` and `zapp` are in `/opt/homebrew/bin` on this Mac, so chat, firmware builds and Moonlander flashing could not work from the app. kanata, also there, was unaffected, because its lookup checks Homebrew's folders directly. The chat panel also told him to "stop keyloom in your terminal and start it again". That doesn't apply inside the app, and a Codex sign-in needs no restart: every status check runs `codex login status` again.

Fix (D-441): the app asks the login shell for its PATH, with a 3-second deadline over the whole exchange, and starts `keyloom serve` with it. The chat panel now says that a Codex sign-in is picked up by checking again, and that an API key needs keyloom started again. Run under the app's minimal environment, the first version of the lookup returned BK's full PATH in 364 ms, and codex, docker and zapp all resolved on it.

Status: fixed on branch fix/desktop-provider-keys.

The desktop shell now passes non-empty allowlisted provider settings from the same bounded login-shell exchange as PATH, while preserving values already set in the app environment. The desktop crate tests cover the allowlist, unset and repeated values, values containing `=`, the deadline and a pipe held open by a background process (D-443).

Earlier release: d5ac21f (PR 167), v0.53.2. Checked on BK's Mac on 2026-10-22, with the installed v0.53.2 app opened from a stripped environment (`env -i … PATH=/usr/bin:/bin:/usr/sbin:/sbin open -a`):
- `ps eww` showed `keyloom-desktop` with that minimal PATH, and its `keyloom serve` with BK's full shell PATH.
- codex, docker and zapp resolved on the sidecar's PATH.
- Cmd+K opened chat ready for a message ("Tell keyloom what's getting in your way"), not "Chat needs a model". This was read through Codex Computer Use's accessibility output, because its screenshot came out blank.
