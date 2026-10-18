# The agent's main coverage gap is workflow control

Source baseline: `origin/main` at `c5efcb583c69df8841d154990fd3e63e92f9207b`, inspected on 2026-10-18 by the read-only capability-discovery worker in session `ses_eafd42e96ffegq8EzVT3LTIkj1`. This is S56's source inventory, not an executed conformance test. No provider, server, real data directory or hardware was accessed. The new [app-control chapter](../blueprint/29-agent-app-control.md) defines the intended coverage; these tables describe what exists.

The existing `ChangeOp` vocabulary covers the layout-edit families. Most missing agent capabilities are operations around them: config/history lifecycle, live device state, sync/build control, review management, recording controls and app navigation. The model's prompt does not prove a capability exists. Callable tools are registered in [tools/index.ts](../../src/agent/tools/index.ts); their scope is implemented in [app/agent-ports.ts](../../src/app/agent-ports.ts).

## The read maps workflow to implementation

UI handlers and API routes frequently compose concrete backends in `src/cli/`, not in `src/server/`. These adapters expose the actual effects and are useful reuse points:

- [editor-backend.ts](../../src/cli/editor-backend.ts)
- [configs-backend.ts](../../src/cli/configs-backend.ts)
- [sync-backend.ts](../../src/cli/sync-backend.ts)
- [keyboards-backend.ts](../../src/cli/keyboards-backend.ts)
- [review-backend.ts](../../src/cli/review-backend.ts)
- [decisions-backend.ts](../../src/cli/decisions-backend.ts)
- [lab-backend.ts](../../src/cli/lab-backend.ts)
- [chat-backend.ts](../../src/cli/chat-backend.ts)

The table's CLI forms are source-read command families, not commands executed during the spike. “Missing” means absent from the registered tools/ports inspected at this SHA. The whole-app conformance gate remains to be implemented and run.

## Collection, configs and versions already have reusable services

| Workflow | UI/API | Application seam | CLI family | Callable agent coverage |
|---|---|---|---|---|
| Inspect boards/configs/keys | `App`, `Viewer`, `useConfigs`; GET layouts/boards/configs | `listLayouts`, `getLayout`, `listConfigs`, `listBoardDefinitions`, `showBoard` | `layout list/show`, `boards list/show`, `config list` | `list_layouts`, `get_layout`, `find_function`; no historical-version or standalone discovery tool |
| New config from current, another config, version or blank | `NewConfigDialog`, POST `/api/configs` | `newConfig`, `newBlankConfig` | `config new` | `create_config` only covers current-config copy or its board's blank |
| Import | `ImportScreen`, POST `/api/import` or configs with import source | `importUpload`, `importLayout`, `newConfigFromUpload` | `import`, `config new --from import` | Missing |
| Rename/archive/restore/delete config | Config dialogs; POST config lifecycle routes | `renameConfig`, `archiveConfig`, `restoreConfig`, `deleteConfig` | `config rename/archive/restore/delete` | Missing |
| List/compare/name versions and read revisions | History, compare; config versions/compare routes | `versionHistory`, `compareRevision`, `nameVersion`, `listRevisions` | `version list/compare/name` | Missing |
| Undo/redo/restore | `Viewer.undo/stepRevision`; undo/version-restore routes | `undo`, `restoreVersion` | `undo`, `version restore` | Missing |
| Put an old version on the keyboard | `Viewer.putVersionOn`; restore then use/sync | Composition of restore and sync, not one atomic use case | `version restore` followed by `config use` or `sync` | Missing |
| Copy a setup to another registered board | Keyboard put preview/make routes | `previewPut`, `putConfig` | `keyboard put` | `put_config` creates config/proposals; does not activate, build or flash |
| Copy behaviors, lighting or combos between layouts | Existing chat-mediated mapping | `mapLayer`, `planBehaviourCopy`, `planLightingCopy`, `planComboCopy` | Generic change ops; no dedicated mapping command found | `map_keys`, then proposals against the conversation's config |

Sources: [configs.ts](../../src/app/configs.ts), [versions.ts](../../src/app/versions.ts), [history.ts](../../src/app/history.ts), [import-upload.ts](../../src/app/import-upload.ts), [keyboard-put.ts](../../src/app/keyboard-put.ts), [copy-plan.ts](../../src/agent/copy-plan.ts), [config CLI](../../src/cli/commands/config.ts), [version CLI](../../src/cli/commands/version.ts), [config routes](../../src/server/config-routes.ts).

Two details affect future parity work:

1. Agent blank creation calls synchronous `newConfig(...from: "blank")`, which uses `blankDocument`. UI/CLI blank creation calls `newBlankConfig`, which can read the board's firmware default. These are not the same default behavior at this SHA. Do not report them as already equivalent.
2. The UI offers config deletion under archived configs. `deleteConfig` checks the exact name, active-config status and running sync, but does not itself require archive. Any new agent action must use the application guards, not infer a domain rule from menu placement.

## One checked change path covers the edit families

The shared path is [api-write.ts](../../src/web/api-write.ts) -> [editor-routes.ts](../../src/server/editor-routes.ts) -> [appEditorBackend](../../src/cli/editor-backend.ts) -> [changes.ts](../../src/app/changes.ts). UI check/apply endpoints are `POST /api/layouts/:ref/check|apply`; CLI uses `change check/propose/apply`. Agent tools `analyse_change` and `propose_changes` cover supported [ChangeOpSchema](../../src/layout/change.ts) variants, but the agent cannot Apply.

| Edit family | Existing UI/planning seam | Shared representation |
|---|---|---|
| Key/modifier/layer action, hold-tap, transparent/none/native replacement | `KeyPanel`, `panel/change-ops.ts` | Binding ops; explicit native-replacement confirmation |
| Move/swap/drag-copy/paste/quick assign | `Viewer`, `editor/move-ops.ts` | Ordinary binding/move/swap ops |
| Repeat on selection | `RepeatPanel`, `editor/repeat-plan.ts` | Expanded ordinary ops |
| Macro and per-key/shared editing | `MacroPane`, `KeyPanel` | Macro and binding ops |
| Double-tap, tap-then-hold, dance timing | `KeyPanel`, `panel/dance.ts` | Tap-dance and binding ops |
| Combos: keys/output/layers/timeout/delete | `ComboPane`, `combos/combo-ops.ts` | Combo ops |
| Layers: add/rename/duplicate/reorder/style/convert/delete | `Viewer.layerActions`, `layout/layer-ops.ts` | Layer and binding ops |
| Conditional layers | `LayerMenu`, `layers/conditional-ops.ts` | Conditional-layer ops |
| One/shared hold-tap profile | `ProfileTuner`, `editor/tuning.ts` | Profile and optional binding ops |
| Firmware settings and LED colors | `SettingsPane`, `layout/settings-ops.ts`, `settings/lighting-ops.ts` | Firmware-setting and layer-lighting ops |
| Preserve/move/drop displaced functions | `KeyPanel`, `Viewer.perform/DropConfirm` | Binding ops and explicit `dropFunction` |

Further workflow gaps:

- `parseBindingExpression` has a UI/API path but no dedicated CLI parser or agent tool found. It is not an additional mutation path.
- Saved proposal Apply uses `applyChange`; the UI and CLI can do it, the agent cannot. Listing/showing/rejecting a saved proposal exists in the CLI. The chat's “Not this” unpins; it does not call `rejectChange`.
- `upgradeLayout` has an editor/API/CLI path for older Oryx representations, but no callable agent tool.

Do not invent a new macro/combos/layer editor backend to fill an agent workflow gap. Adapt the shared use cases and preserve validation.

## Memory, review, conversation and display controls have separate ownership

| Workflow | Existing seam | CLI/agent gap |
|---|---|---|
| Read/run/force review | `useReview`, `ReviewEngine.show/review` | CLI `review` exists; no chat-callable review tool |
| Hide/restore finding | Review item routes, `dismissReviewItem/restoreReviewItem` | No corresponding CLI command found; no agent tool |
| Read/edit/retire decisions | `DecisionsView`, decision routes, `listDecisions/editDecision/retireDecision` | CLI exists; no list/show/edit/retire agent tools |
| Record/remove priority | `recordPriority`, priority deletion route | Agent can record; cannot retire; no direct CLI priority-create command found |
| Due outcome prompts, answer/dismiss | `outcomeQuestions`, `recordOutcome`, `dismissOutcome` | CLI exists; agent only records helpful/unhelpful for a current-layout choice |
| Send/retry/question answer/Stop | `useChat`, chat route, `sendMessage` | Lifecycle is caller-owned; Stop aborts request; `ask_user` creates a question |
| New/open/list conversations | `useChat`, summaries/detail routes | CLI lists and resumes; no standalone transcript-show/delete command found; no management tools |
| Save next provider/model | `ProviderPicker`, `providerStatus/chooseNextProvider` | CLI overrides exist; no persistent setter command or agent tool found |
| Theme | `shell/theme.ts` | Browser-local storage, no client-intent channel/API/app use case/CLI |
| Separate case/keycap colors | `keyboard/colourway.ts` | Browser-local per-board choices, no client-intent channel/API/app use case/CLI |

Sources: [review engine](../../src/app/review-engine.ts), [decisions](../../src/app/decisions.ts), [conversations](../../src/app/conversations.ts), [chat-model](../../src/app/chat-model.ts), [commands](../../src/web/chat/commands.ts), [theme](../../src/web/shell/theme.ts), [colourway](../../src/web/keyboard/colourway.ts).

Local navigation, key/layer focus, panels, proposal hover/pin/compare, clipboard, Inspect and phone sheet controls are view state, not config mutations. A future client-intent channel must acknowledge a real view change; a CLI without an attached view cannot claim it opened a panel. Case/keycap color is not firmware LED lighting.

## Device workflows already own their safety gates

| Workflow | Existing application/engine seam | CLI | Agent today |
|---|---|---|---|
| Detect/search/preview/register keyboard | `detectKeyboards`, `searchKeyboards`, `previewKeyboard`, `addKeyboard` | `keyboard detect/add` | Missing; `put_config` cannot register first |
| Read live connection/sync state | Sync engine snapshot/views, `syncStatus` | `sync status` | Missing; `list_layouts` shows intended config ownership, not live device state |
| Sync active config | `SyncEngine.syncNow`, `runSync` | `sync` | Missing |
| Select config on keyboard | `SyncEngine.useConfig`, `runUseConfig` | `config use` | Missing; not the meaning of `put_config` |
| Enable/disable/pause/resume auto-sync | `setAutoSync`, `setPaused` and application equivalents | `autosync` | Missing |
| Build/flash/status/logs | `startBuild/getBuild/startFlash/getFlash` | `build`, `flash` | Missing |
| Generate source export | `generateFirmware` | `generate` | Missing; no browser export/download route found |
| Bootloader reboot only | `rebootKeyboard` | `flash --reboot-only` | Missing; no browser route found |
| Remapper setup/doctor/proof/direct apply | `setupRemapper`, `remapperDoctor`, `confirmExitChord`, `applyToRemapper` | `remap` | Missing; browser largely displays setup instructions |
| Disable remapping | Engine `disableRemapping`, `disableRemapperFor` | `remap disable` | Missing |

Sources: [keyboard routes](../../src/server/keyboard-routes.ts), [sync routes](../../src/server/sync-routes.ts), [sync engine](../../src/app/sync-engine.ts), [firmware](../../src/app/firmware.ts), [remapper](../../src/app/remapper.ts), [keyboard CLI](../../src/cli/commands/keyboard.ts), [firmware CLI](../../src/cli/commands/firmware.ts), [sync CLI](../../src/cli/commands/sync.ts), [remap CLI](../../src/cli/commands/remap.ts).

The sync engine refreshes device observations, checks config ownership/archives, refuses foreign firmware/config, checks busy state and owns safe pausing/proof gating. Editor/restore adapters notify the engine after Apply. An active-config Apply can therefore start enabled auto-sync. New agent capabilities must retain that effect chain rather than calling a lower-level writer and claiming parity.

## The typing lab exposes aggregates to the agent, not controls

| Workflow | Existing seam | CLI | Agent today |
|---|---|---|---|
| Passage/custom-text choice, recordings list | `labPassages`, `sessions`, `cannotRecord` | `lab passages/sessions` | Missing |
| Start/stop/cancel capture | `beginRecording/endRecording`; lab adapter holds one capture | Interactive `lab start`; no standalone stop/cancel command | Missing |
| Read/analyse recording and findings | `labReadout`, `analyseSession` | `lab analyse` | `get_typing_findings` reads existing aggregates only |
| Apply a suggestion | Ordinary proposal Apply | `change apply` | Missing |
| Delete recording | `deleteSession` | `lab delete` | Missing |
| Diagnostics | `runDoctor` plus toolchain/keyboard/remapper checks | `doctor`, `remap doctor` | Missing; no browser route found |
| Firmware emulation | `emulateLayout` | `emulate` | Missing; `analyse_change` validates rather than emulates |

Sources: [lab use cases](../../src/app/lab.ts), [lab adapter](../../src/cli/lab-backend.ts), [lab routes](../../src/server/lab-routes.ts), [lab CLI](../../src/cli/commands/lab.ts), [doctor](../../src/app/doctor.ts), [emulation](../../src/app/emulate.ts).

## Human and native-shell steps are not hidden tools

File chooser/drop gestures, export from another editor, credential provisioning, administrator installation, permissions, physical exit-chord proof, typing a passage and manual bootloader steps remain human/OS-owned. `remap setup` prints the root command instead of running it.

The desktop tray Sync relays to the existing sync route. Native Open/Quit/Launch-at-login are shell actions, not existing shared app use cases. Keep this distinction explicit when claiming “the whole app”; a graceful local handoff is required where the agent cannot perform a protected gesture.

## S56 still needs executable conformance

This read did not test handlers, installed binaries, provider adapters, firmware drivers or native updater/sidecar lifecycle. It did not infer test quality from test filenames. Contributor source editing/check/geometry generation was excluded from runtime capability coverage.

Before rungs 28, 28b and 28c ship, turn each workflow into an explicit action-inventory row with policy, typed inputs, result renderer and an observed UI/CLI/agent journey. Add negative cases for the existing safeguards. Refresh against the implementation SHA. This source inventory is evidence for planning, not a declaration that parity is already achieved.
