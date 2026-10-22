# The desktop app can't find codex, docker or zapp

BK's installed 0.53.1 app showed "Chat needs a model" when he pressed Cmd+K, although `keyloom provider` in his terminal reported Codex as ready. The app's processes ran with launchd's PATH:

```
18828 /Applications/keyloom.app/Contents/MacOS/keyloom-desktop     PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
19063 …/MacOS/keyloom serve --port 55231 --no-open --exit-on-stdin-close --reuse   PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

`codex`, `docker`, `zapp` and `kanata` are all in `/opt/homebrew/bin` on this Mac, so chat, firmware builds, Moonlander flashing and the kanata binary lookup could not work from the app. The chat panel also told him to "stop keyloom in your terminal", which doesn't apply inside the app.

Fix (D-441): the app asks the login shell for its PATH, with a 3-second deadline, and starts `keyloom serve` with it. The chat panel now says to quit and reopen the app, or restart `keyloom serve`. Run under the app's minimal environment, the lookup returned BK's full PATH in 364 ms, and all four tools resolved on it.

Status: fixed on branch `fix/desktop-login-path`. Still to check: the installed app from the release that carries this, with chat working and the sidecar's PATH read back from `ps`.
