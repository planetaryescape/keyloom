# Ask the agent to open a view

Open History, the typing lab, Decisions or settings from the conversation on your current config. This capability shipped in v0.66.0. It opens an existing view; it does not start recording, save settings, apply changes or control hardware.

## Send the request

Use the web or desktop app with an existing config and a configured [AI provider](../README.md#ai-providers). Use a config without unfinished edits or an active recording.

1. Press `⌘K` to open the conversation.
2. Type one of these requests:

   | Request | Destination |
   |---|---|
   | `Open History` | The config's layout versions, not its conversation history |
   | `Open the typing lab` | The existing lab screen, without starting a recording |
   | `Show my Decisions` | The conversation column's Decisions view |
   | `Open settings` | The existing settings panel, without saving anything |

3. If command suggestions appear, choose `Ask keyloom` to send the words to the agent. Pressing Enter on a highlighted local command runs that command instead; it does not test the agent tool.
4. Keep this window focused while the request runs. Reopen the conversation if the destination replaces it to read the result.

The tool returns `opened` or `already-open` only after the client acknowledges rendering the destination. That does not prove its data loaded. The model's reply wording can vary.

## Recover when the open is unavailable

If you edited, navigated away, changed configs, started recording or stopped the run, the old request must not take over your screen. A background window, disconnected observer or expired five-second wait can also prevent confirmation. Return to the intended config and send a fresh request when ready; do not resend automatically after losing a response. Reading an old conversation or reloading it never executes its saved view requests.

An unavailable result means there is no confirmed open. The screen may already be visible if rendering succeeded but its acknowledgement was lost. Check the screen before asking again. It is not evidence that the destination's underlying feature is unsupported.

Terminal and legacy clients cannot open an unrelated browser. See [terminal view-request results](blueprint/10-cli.md#view-requests-from-the-terminal-d-469).

## See also

- [Finite view intent and acknowledgement contract](blueprint/29-agent-app-control.md#implemented-finite-view-contract-d-469)
- [Verification evidence and explicit v0.66.0 waivers](research/ui-audit/d-open-view/README.md): app/CLI tests passed; real-browser journeys and independent review were waived, not passed. This guide describes the implemented contract, not newly observed GUI acceptance.
