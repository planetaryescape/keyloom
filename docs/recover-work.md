# Recover work after a failed read

Use the recovery control beside the failure before repeating a request or starting another install. These steps apply to v0.80.6 and later.

## Keep a loaded editor open

If a background layout read fails, leave the loaded page open. The notice says that keyloom keeps your draft. Choose `Try again` when the notice offers it. A successful read updates the page in place.

The shown layout can lag behind a saved change. A failed refresh alone does not mean that Apply failed. Read the layout again before repeating the change.

If keyloom reports a deleted layout, choose `Show your other layouts`. If no page loaded yet, use the initial error screen's recovery controls. Draft retention here covers an already-mounted editor. It does not promise recovery of unsent text after a browser reload.

## Resume reading an accepted reply

If chat says `Can't read the saved reply`, choose `Resume reply`. This reads the same saved run without sending the request again. Short connection failures retry their reads automatically.

Choose `Open history` to inspect the saved conversation. If keyloom reports a permanent read failure or an expired page link, follow the shown restart guidance.

To inspect the same run from the CLI, replace `<data-dir>` with that instance's data directory. Replace `<run-or-request-id>` with its saved identity:

```sh
keyloom --data-dir <data-dir> --format json agent show <run-or-request-id>
```

This command prints the saved run snapshot. It starts no model and repeats no tool. See [saved agent work](blueprint/10-cli.md#inspect-saved-agent-work-before-continuing-it) for intentional new requests and cancellation.

## Read model setup again

If model setup cannot read the configured models, choose `Try again`. The model picker remains available while that read fails. A successful retry shows the configured providers.

Changing the provider for a new conversation does not change an existing conversation's provider. See [model providers](blueprint/19-model-providers.md).

## Recover install tracking

If keyloom loses track of a Codex install, choose `Check again` when offered. That button reads the current job. It does not start another installation. The install log remains available.

If the failure requires `Restart keyloom`, finish any active keyboard write before restarting. If the install itself reports failure, its `Try again` button starts another install attempt.

## Restore a config from a reply

If an agent-created config card says `This config is archived`, choose `Restore and open`. Restoration uses the same operation as Restore under Archived configs. It does not apply firmware or write to a keyboard.

If restoration fails, the card keeps the reason. Resolve that failure before choosing `Restore and open` again. If you switch configs while restoration waits, its late response does not navigate you away.

## Leave an unavailable board preview

If a board-development link says that its preview is unavailable, choose `Open keyloom`. This returns to the normal app. For a temporary preview read failure, choose `Try again`.

## Check the recovery boundary

The implementation keeps reads separate from actions:

- [Saved reply reads](../src/web/chat/api-chat.ts) and [run identity/completion handling](../src/web/chat/useChat.ts) keep observation recovery on the accepted run.
- [Page refresh](../src/web/App.tsx) keeps the loaded editor mounted while a read fails.
- [Install tracking](../src/web/release/useInstall.ts) separates Check again from install and cancel commands.
- [Config cards](../src/web/chat/ConfigCards.tsx) preserve restore failures and ignore navigation after unmount.

For release installation problems, use [desktop verification](verify-desktop-install.md). For a validator-refused proposal, use [proposal recovery](blueprint/10-cli.md#recover-a-refused-proposal).
