# Combined corrections candidate: execution blocked

**RED: the open model picker remains below the viewport after resizing 1440×900 → 1280×577.** Execution stopped at this concrete runtime blocker, as instructed. The carried-thread, browser proposal and working-order journeys were not run or declared passed.

## Exact candidate

- Binary: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-focus-0421-install-e8hjxff3/keyloom-corrections-candidate`.
- SHA-256 verified before/after: `214390edc85e2a99c2107c2daca2105a9d34a11a6f69ef778c44404ab46f614e`.
- Supplied version: **0.43.0 candidate** before release-please; this is not acceptance of the earlier public 0.43.0 binary.
- Source: `4ecc7df730ae0a54da200c722ce47307169d9f66`; tree: `aaa8d174f4720c8c2e83d75c9b084b44f866e552`; `src`: `636e1dc1de69f7881dc571c111a01618ebf4f005`.
- Scratch: `/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/keyloom-agent-corrections-compiled`; budget 1 GiB, retained pending cleanup approval.

This packet used the compiled app and real UI controls. No mutable-source server, HTTP response fixture or DOM replacement was used. Prior source/public/compiled packets remain unchanged.

## Minimal runtime reproduction

1. Serve the candidate on owned port 4510 with private scratch config choosing Codex, a synthetic model, and the deterministic fake Codex path. **Neither** `KEYLOOM_PROVIDER` **nor** `--provider` is set; provider fields are editable.
2. At **1440×900**, open Ask → chat More → Model. Save `qa-corrections-model-1440` by pointer, reopen/edit/Cancel, and reopen/Escape. These checks passed: the actual config saved exactly, Cancel preserved it, and Escape returned focus to chat More.
3. Reopen Model at 1440×900. Leave the picker open and resize to **1280×577**. Wait two animation frames, then try to bring the Model field into view through normal scrolling.
4. The actual compiled picker remains at **y=446.203–839**, while both `innerHeight` and `visualViewport.height` are **577**. Its Model input is **y=746–778**; Cancel and Use for new conversations are **y=790–822**. They are outside the visible viewport. The chat More anchor has already moved to **y=524–552**.

**Smallest violated invariant:** resizing an already-open model picker must keep its input and Cancel/Save controls reachable within the real viewport. Page/body horizontal width is correct (1280); the failure is vertical positioning, not a provider lock or missing credential.

Affected source component: `src/web/chat/ProviderPicker.tsx`, positioning/listener effect around lines 43–103. No production fix or speculative root-cause claim was made.

Proof:

- [Failed geometry values](model-geometry-failed-assertion.json)
- [Window/visual viewport, picker style and anchor context](model-geometry-context.json)
- [Actual clipped screenshot](model-geometry-failed-1280.png)
- [AX snapshot](model-geometry-failed.ax.txt)
- [Initial working 1440×900 picker](model-picker-1440x900.png)
- [Exact saved scratch model config](model-config-after-1440.json)

The failed positions remained unchanged during subsequent evidence capture; this was not claimed from a transient frame. No closing/reopening workaround or DOM/style change was used to make the resized state pass. Sizes 1000×320 and 390×844 were not exercised after this blocker. Chromium execution does not certify old WebKit.

## Narrow authorized fixture seed

Before any server started, installed CLI verified autosync explicitly off on **Moonlander and Glove80**. The parent-authorized exception then used **change check → propose → apply** once on the synthetic Glove80 only: `setLayerStyle` set the first layer's shortLabel to **SYN**, preserving its existing display colour. No bindings or hardware lighting changed.

The resulting head was reread, SYN and unchanged colour verified, both autosync choices rechecked false, and read-only SQLite inspection found **0 builds, 0 flashes and 0 syncs**. The post-seed head/display ops were regenerated. This is the **only Apply** in this QA and occurred before the server/sync engine existed. No UI Apply was used. See [authorized-fixture-seed.json](authorized-fixture-seed.json) and [setup.json](setup.json).

All 21 installed preflight checks passed. Setup also accepted the display-only ops and refused Glove80 physical `setLayerLighting` with CLI exit 4 / `lighting_unsupported`. These are setup/validator observations, **not** a claimed browser MCP proposal pass. See [preflight-results.json](preflight-results.json).

## Commands and cleanup

```sh
python3 scripts/spikes/agent-corrections-smoke.py prepare \
  --binary "$BINARY" --sha256 214390edc85e2a99c2107c2daca2105a9d34a11a6f69ef778c44404ab46f614e \
  --source 4ecc7df730ae0a54da200c722ce47307169d9f66
python3 scripts/spikes/agent-corrections-smoke.py scenario --scenario inspection
python3 scripts/spikes/agent-corrections-smoke.py serve \
  --binary "$BINARY" --sha256 214390edc85e2a99c2107c2daca2105a9d34a11a6f69ef778c44404ab46f614e
```

`$BINARY` is the exact path above. The real capability URL came privately from `session/data/serve.json`; no token-bearing URL, headers, environment record or provider replay is included here.

Owned server/group **11184**, port **4510**, received SIGINT and exited **0**. Named browser **keyloom-agent-26b-acceptance** was closed. [resources.json](resources.json) records the artifact and isolation. Empty CODEX_HOME and the `/dev/null` record sink remained intact. [health.json](health.json) recorded zero uncaught browser errors; the only HTTP error observed was `/favicon.ico` 404.

No other process, real app/data/global installation, production file, build, full suite, eval, live/paid provider, device operation, sync, flash, recording, remapping, commit, push or release was touched. Parent retains integration, correction, CI/release and real-running-app gates. Remaining journeys require a newly frozen corrected artifact; this packet is not an overall acceptance pass.
