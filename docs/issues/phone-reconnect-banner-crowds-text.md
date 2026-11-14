# Reconnect banner crowds its text on phones

Status: fixed by `280a0de7`, awaiting release.

At `origin/main` commit `6034e1c2`, the browser reconnect banner gives its text only 8.234375px at a 390×844 viewport. The fixed-size copy command takes 206.265625px. The banner grows to 468.25px and its text crosses behind the command control.

The reproduction injects HTTP 503 responses after a valid sync stream connects. It uses the unchanged editor with fake firmware, a synthetic layout and no hardware actions. Returning the stream restores the page and preserves the unsent draft. Those behaviors must stay.

The correction sets a bounded banner width. On narrow screens, a two-column grid keeps the icon beside the text and puts the command below it. Final measurements give the text 308px and reduce the banner to 138.53125px.

Both themes pass axe and viewport checks at 1440×900 and 390×844. The 320px check passes after the board's resize settles. The banner also fits at 600px, 601px and 768px. Expired-link text stays readable. Automatic reconnect removes the banner and preserves the unsent draft. No server or chat behavior changed.

To reproduce without editing a keyboard, start a separate scratch server:

```sh
KEYLOOM_CREDENTIAL_STORE=none keyloom --data-dir "$(mktemp -d)" serve --port 0 --no-open
```

Open its printed URL at phone width. Stop only that scratch server with Ctrl-C. The reconnect banner appears after about three seconds.

Local evidence is outside the public repository: `../.orchestrate/keyloom-design-review/evidence/r3/outage-before.json`, `browser.json`, `browser-final.json` and `final-outage-contact.jpg`. The first browser file includes an unsettled 320px overflow reading. The final capture waits for resize and passes. The main review retains the before/after screenshots and the failed spacing check that led to the token correction.
