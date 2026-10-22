# The config menu and ⌘K miss a config the agent made

BK asked the agent to put his Glove80 setup on another board and to make a new config. The agent made it and said "Switch to it from the config menu", but the menu listed only the config he was on until he reloaded the page. He reported it on v0.53.2: the server's `GET /api/configs` returned both configs while the menu showed one. I did not rerun v0.53.2 to see that response.

The cause is in `src/web/configs/useConfigs.ts`. The list loads when its key changes, and the key is the config on screen's id, name and head revision. An agent-made config changes none of them, so nothing asked for the list again. The comment above the hook said a "copy" changes the list, which was true only for a copy made from the menu.

Fix (D-450): the chat reports every turn to the page, and the page reloads the config list once for each config a turn names (a `put_config` or `create_config` operation's config reference) that the list lacks. The same change opens the config and shows a card for it, and the card's "Open" also reloads the page's own layout list, because selecting a config that list lacks left the page on "Loading layout". Checked in the browser on a scratch data directory with a scripted model behind the real server: after the reply the menu listed the new config without a reload.

Status: fixed in b2b497d.
