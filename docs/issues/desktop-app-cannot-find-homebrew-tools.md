# The desktop app can't find codex, docker or zapp

BK's installed 0.53.1 app showed "Chat needs a model" when he pressed Cmd+K, although `keyloom provider` in his terminal reported Codex as ready. The app's processes ran with launchd's PATH:

```
18828 /Applications/keyloom.app/Contents/MacOS/keyloom-desktop     PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
19063 …/MacOS/keyloom serve --port 55231 --no-open --exit-on-stdin-close --reuse   PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

`codex`, `docker` and `zapp` are in `/opt/homebrew/bin` on this Mac, so chat, firmware builds and Moonlander flashing could not work from the app. kanata, also there, was unaffected, because its lookup checks Homebrew's folders directly. The chat panel also told him to "stop keyloom in your terminal and start it again". That doesn't apply inside the app, and a Codex sign-in needs no restart: every status check runs `codex login status` again.

Fix (D-441): the app asks the login shell for its PATH, with a 3-second deadline over the whole exchange, and starts `keyloom serve` with it. The chat panel now says that a Codex sign-in is picked up by checking again, and that an API key needs keyloom started again. Run under the app's minimal environment, the first version of the lookup returned BK's full PATH in 364 ms, and codex, docker and zapp all resolved on it.

Not fixed: an API key exported in a shell profile still doesn't reach the app, because only PATH is taken.

Status: fixed on branch `fix/desktop-login-path`. Still to check: the installed app from the release that carries this, with chat working and the sidecar's PATH read back from `ps`.
