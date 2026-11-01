# 02: Layout model

Status update, 2026-11-01: per-layer ZMK encoder turns are implemented (D-469). `Layer.sensorBindings` optionally stores firmware-ordered rotation pairs (clockwise/counterclockwise key, none or native actions), or whole imported sensor calls. Absence retains board defaults; `setSensorBindings` with null restores them. Presses remain ordinary key bindings. Validation includes reachable encoder functions, and duplicate, stale-check, export, undo and history paths retain the turns.

keyloom's own firmware-neutral layout document is the thing everything edits (D-033). Chat and the editor change it through change sets (D-013, D-014). Importers produce it from QMK or ZMK source. Generators turn it back into firmware source ([05](05-firmware-qmk.md), [06](06-firmware-zmk.md)). The local SQLite database stores revisions of it, plus the conversations and decisions around it (D-032).

## Conventions

- **IDs** are ULIDs stored as text, with a type prefix: `lay_`, `rev_`, `cs_`, `conv_`, `msg_`, `dec_`, `bld_`, `fl_`. The prefix makes a pasted ID self-describing in CLI output and logs.
- **Instants** are epoch milliseconds in `INTEGER` columns. Names end in `At` in TypeScript and `_at` in SQL.
- **JSON columns** hold documents validated by the zod schemas in `src/layout/schema.ts`. Every read parses with zod. A row that fails to parse is a bug and fails loudly. It is never coerced.
- **Positions** are integers indexing the board definition's `keys` array ([04](04-boards-and-contributions.md)). That order is the order the firmware's layout macro (QMK) or bindings list (ZMK) uses, so position N is binding N in both.
- **Layers are referenced by `id`, never by index.** The index is assigned only when firmware is generated, so reordering layers doesn't break references.
- **Revisions are immutable and history is append-only.** Undo creates a new revision (D-015).

## The layout document

```ts
// src/layout/schema.ts — the zod schemas are the source; these types are inferred from them.

type Firmware = "qmk" | "zmk" | "kanata";

type Layout = {
  schemaVersion: 1;
  boardId: string;                 // "zsa/moonlander", "moergo/glove80"
  firmware: Firmware;              // copied from the board definition (D-002)
  layers: Layer[];                 // order = firmware layer number; layers[0] is the base layer
  macros: Macro[];
  tapDances: TapDance[];           // 16#tap-dance-is-a-key-with-a-double-tap-slot; [] in documents stored before rung 14
  combos: Combo[];
  conditionalLayers: ConditionalLayer[]; // "when A and B are both on, also turn on C" (D-385); [] in documents stored before it
  holdTapProfiles: HoldTapProfile[];
  settings: FirmwareSetting[];     // global tap-hold and other firmware options (D-017)
  passthrough: Passthrough[];      // source keyloom can't model, kept verbatim (D-024)
};

type Layer = {
  id: string;                      // stable slug, e.g. "base", "num"
  name: string;                    // "Numbers"
  bindings: Binding[];             // length === board.keys.length
  sensorBindings?: SensorBinding[]; // firmware sensor order; absent means board defaults (D-469)
  shortLabel?: string;             // up to 4 characters, printed on layer keys; default: first letters of the name (D-180)
  color?: 1 | 2 | 3 | 4 | 5 | 6;   // display only; default: the layer's place in the list (D-180)
};

type Mod = "LCTL" | "LSFT" | "LALT" | "LGUI" | "RCTL" | "RSFT" | "RALT" | "RGUI";

type SensorAction = Extract<Binding, { kind: "key" | "none" | "native" }>;
type SensorBinding =
  | { kind: "rotation"; clockwise: SensorAction; counterclockwise: SensorAction }
  | { kind: "native"; source: string }; // whole imported sensor call, not a key action

type Binding =
  | { kind: "key"; code: KeyCode; mods?: Mod[] }                    // "A", "N1", Cmd+Shift+4
  | { kind: "modifier"; mods: Mod[] }                               // a plain modifier key, e.g. Option
  | { kind: "holdTap"; tap: TapAction; hold: HoldAction; profileId: string }
  | { kind: "layer"; action: "momentary" | "toggle" | "to" | "oneShot"; layerId: string }
  | { kind: "macro"; macroId: string }
  | { kind: "transparent" }                                         // falls through to the layer below
  | { kind: "none" }                                                // does nothing
  | { kind: "native"; firmware: Firmware; source: string; label: string }; // escape hatch (D-024)

// Exactly one: a nonempty key code, or a macroId without key modifiers.
// The parsed macro form uses code: "" as a compatibility sentinel for existing consumers.
type TapAction = { code: KeyCode; mods?: Mod[] } | { code: ""; macroId: string };
type HoldAction = { mods: Mod[] } | { layerId: string };

type Macro = {
  id: string; name: string;
  steps: MacroStep[];              // press, release, tap, waitMs, text
};
type MacroStep =
  | { op: "tap" | "press" | "release"; code?: KeyCode; mods?: Mod[] }
  | { op: "waitMs"; ms: number }
  | { op: "text"; text: string };  // typed as written, US layout; Shift is added where a character needs it (D-155)

type Combo = {
  id: string; name: string;
  positions: number[];             // two or more positions pressed together
  layerIds: string[] | "all";
  output: Binding;                 // not a holdTap; see 07
  timeoutMs?: number;
};

type ConditionalLayer = {
  id: string;
  ifLayerIds: string[];            // exactly two layer ids
  thenLayerId: string;             // not one of the two
};

type HoldTapProfile = {
  id: string; name: string;        // "home-row-mods", "thumb-layer"
  firmware: Firmware;
  options: Record<string, number | boolean | string | number[]>; // firmware-native names
};

type FirmwareSetting = { firmware: Firmware; key: string; value: number | boolean | string };

type Passthrough = { firmware: Firmware; file: string; anchor: string; source: string };
```

### KeyCode is keyloom's own name set

`KeyCode` is a closed string union of keyloom names. A name is QMK's canonical keycode without the `KC_` prefix, with digits written `N0`…`N9`: `A`…`Z`, `N0`…`N9`, `ENTER`, `BACKSPACE`, `TAB`, `SPACE`, `MINUS`, `LEFT_BRACKET`, `F1`…`F24`, `LEFT`, `AUDIO_VOL_UP`. Every other QMK alias and every ZMK name resolves to one. `src/layout/keycodes.ts` maps each name to its QMK `KC_*` code and its ZMK name, with a label, aliases and a category for the key picker.

The table is generated, not typed by hand (D-044). `scripts/gen-keycodes.ts` reads ZMK's firmware header `app/include/dt-bindings/zmk/keys.h` (MIT; upstream `zmkfirmware/zmk` `4dd95d7`) and QMK's `data/constants/keycodes/keycodes_*.hjson` (`qmk/qmk_firmware` `7a1bbf3`). It joins them on the HID usage they share. Names that exist on only one firmware are left out of `KeyCode` and are reachable only as `native` bindings. The generated file is committed, and CI regenerates it to check for drift. ZMK's docs file `docs/src/data/hid.js` has the same names with labels, but it's CC-BY-NC-SA-4.0 (header checked at `4dd95d7`), which an MIT project can't take. keymap-editor ships a 2023 copy of it. keyloom uses the MIT header instead ([../research/keymap-editor.md](../research/keymap-editor.md)). A symbol such as `!` is stored as `{ kind: "key", code: "N1", mods: ["LSFT"] }`. The table also flags which names are QMK *basic* keycodes, because a QMK mod-tap's tap side accepts only basic keycodes (qmk/qmk_firmware `7a1bbf3` `docs/mod_tap.md:65`). The validator uses that flag ([07](07-change-validation.md)).

Why a closed set: the agent can only produce names that exist on both firmwares. Anything outside it is a `native` binding, which shows as firmware-specific in the editor (D-024).

### Home row mods in the model

BK's "F and J as Command when held" (D-006) is:

```json
{ "kind": "holdTap", "tap": { "code": "F" }, "hold": { "mods": ["LGUI"] }, "profileId": "home-row-mods" }
```

The profile holds the firmware-specific feel settings. On QMK these are values such as `TAPPING_TERM` and per-key options like Chordal Hold and Flow Tap. On ZMK they are the hold-tap behaviour's `flavor`, `tapping-term-ms`, `quick-tap-ms`, `require-prior-idle-ms` and `hold-trigger-key-positions` (see the firmware research). Tuning the feel means changing a profile, not every key (D-017).

### Passthrough keeps what keyloom can't model

An imported source can contain things outside the model: custom C in `process_record_user`, RGB code, or ZMK behaviours keyloom doesn't know. The importer keeps each one as a `Passthrough` with the file and an anchor, and the generator writes it back unchanged. The editor lists passthrough blocks so BK knows they exist. The agent sees them as opaque and never edits them (D-024). Passthrough is what makes import lossless enough to trust on the first rung (D-016).

## Functions and reachability

A **function** is what a binding ultimately produces, independent of where it sits. It's the canonical string `key:N1+LSFT`, `mod:LALT`, `layer:momentary:num`, `macro:opt-opt`, or the tap or hold half of a hold-tap. Two bindings that produce the same function are interchangeable for reachability. The validator's "nothing gets lost" rule ([07](07-change-validation.md)) compares the set of reachable functions before and after a change, so the definition lives here: `src/layout/functions.ts`.

## Database

One SQLite file at `$XDG_DATA_HOME/keyloom/keyloom.db` (default `~/.local/share/keyloom/keyloom.db`), opened with `bun:sqlite` in WAL mode (D-032). Migrations are numbered SQL files in `src/persistence/migrations/` and run at startup. A database holding a migration this binary does not have is refused before any migration runs: the error names the database's schema and this keyloom's version and says to upgrade (exit 10, D-455), because a keyloom that ignored the rows it didn't know would misread tables a newer one had changed.

```sql
layouts(
  id TEXT PRIMARY KEY,                 -- lay_…
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  head_revision_id TEXT NOT NULL REFERENCES revisions(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  archived_at INTEGER NULL,            -- hidden but kept (25)
  copied_from_layout_id TEXT NULL,     -- plain columns: the source may be deleted
  copied_from_revision_id TEXT NULL
);

-- 25, D-300: the config the sync engine keeps on each board's keyboard.
board_config(board_id TEXT PRIMARY KEY, layout_id TEXT NOT NULL REFERENCES layouts(id));

-- 25, D-301: revisions that went on a keyboard (put_on_at set by a verified sync) or were only named. One row per revision.
versions(
  id TEXT PRIMARY KEY,                 -- ver_…
  layout_id TEXT NOT NULL REFERENCES layouts(id), revision_id TEXT NOT NULL REFERENCES revisions(id),
  board_id TEXT NOT NULL, name TEXT NULL,
  put_on_at INTEGER NULL, ended_at INTEGER NULL, sync_id TEXT NULL REFERENCES syncs(id),
  created_at INTEGER NOT NULL, UNIQUE (layout_id, revision_id)
);

revisions(
  id TEXT PRIMARY KEY,                 -- rev_…
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  parent_id TEXT NULL REFERENCES revisions(id),
  document TEXT NOT NULL,              -- Layout JSON
  origin TEXT NOT NULL CHECK (origin IN ('import','editor','agent','undo')),
  change_set_id TEXT NULL REFERENCES change_sets(id),
  undoes_revision_id TEXT NULL REFERENCES revisions(id),
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX revisions_layout ON revisions(layout_id, created_at);

typing_sessions(                       -- the typing lab (24, D-288); local, deletable, never sent to a model
  id TEXT PRIMARY KEY,                 -- typ_…
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  revision_id TEXT NOT NULL REFERENCES revisions(id),   -- the layout as the keyboard ran it while recording
  board_id TEXT NOT NULL, board_revision TEXT NULL,
  firmware TEXT NOT NULL CHECK (firmware IN ('qmk','zmk')),
  started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL,
  passage_id TEXT NOT NULL, passage TEXT NOT NULL,       -- the steps the person was asked to type
  typed_text TEXT NOT NULL,                              -- what the computer received
  events TEXT NOT NULL,                                  -- the physical trace: position, press or release, ms
  warnings TEXT NOT NULL,
  analysis TEXT NULL, analysed_at INTEGER NULL           -- the last analysis, or NULL
);

change_sets(
  id TEXT PRIMARY KEY,                 -- cs_…
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  base_revision_id TEXT NOT NULL REFERENCES revisions(id),
  proposal_group TEXT NULL,            -- alternatives offered together share it (only calls before D-452 offered several)
  source TEXT NOT NULL CHECK (source IN ('editor','agent')),
  ops TEXT NOT NULL,                   -- ChangeOp[] JSON (03)
  explanation TEXT NOT NULL,
  tradeoffs TEXT NOT NULL,             -- JSON: { gains: string[], costs: string[], supersededDecisionIds?: string[], supersedes?: string } (supersedes: the proposal this one revised, D-452)
  decision_draft TEXT NULL,            -- JSON (08)
  validation TEXT NOT NULL,            -- ValidationResult JSON (07)
  status TEXT NOT NULL CHECK (status IN ('proposed','applied','rejected','superseded')),
  conversation_id TEXT NULL REFERENCES conversations(id),
  created_at INTEGER NOT NULL, decided_at INTEGER NULL
);

conversations(
  id TEXT PRIMARY KEY,                 -- conv_…
  layout_id TEXT NOT NULL REFERENCES layouts(id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

messages(
  id TEXT PRIMARY KEY,                 -- msg_…
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,               -- Anthropic content blocks JSON, stored exactly as sent and received
  selection TEXT NULL,                 -- JSON: positions and layers selected when the user sent it (D-012)
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_conv ON messages(conversation_id, created_at);

decisions(...)                         -- defined in 08

builds(
  id TEXT PRIMARY KEY,                 -- bld_…
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  board_revision TEXT NOT NULL,        -- reva | revb: which hardware the binary is for
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  artifact_path TEXT NULL, log_path TEXT NOT NULL,   -- relative to the data directory
  error TEXT NULL,
  pid INTEGER NOT NULL,                -- the keyloom process running it, so a dead one can be told from a live one
  started_at INTEGER NOT NULL, finished_at INTEGER NULL
);

flashes(
  id TEXT PRIMARY KEY,                 -- fl_…
  build_id TEXT NOT NULL REFERENCES builds(id),
  status TEXT NOT NULL CHECK (status IN ('waiting_for_bootloader','writing','succeeded','failed')),
  error TEXT NULL,
  log_path TEXT NOT NULL, pid INTEGER NOT NULL,
  started_at INTEGER NOT NULL, finished_at INTEGER NULL
);
```

### Applying, undoing and stale bases

- **Apply** runs in one transaction. It re-validates the change set against the current head. It writes a new revision with `parent_id = head`, `origin` from the change set's `source` and `change_set_id` set. Then it moves `layouts.head_revision_id`, marks the change set `applied`, marks the other members of its `proposal_group` `superseded`, and writes the decision ([08](08-decision-memory.md)). If any step fails, nothing changes.
- **Undo** of revision R writes a new revision whose document equals R's parent's document, with `origin = 'undo'` and `undoes_revision_id = R`. A multi-key rearrangement is one revision, so it undoes as one (D-015).
- **A stale base.** If the head moved after a change set was proposed, apply re-validates the ops against the new head. Ops that touch only positions unchanged since the base apply cleanly. Otherwise apply fails with `stale_base`, and the editor or agent re-proposes.
- **Messages store the exact Anthropic content blocks**, including thinking blocks, so the conversation can be resumed append-only. Current models reject edited history that carries thinking blocks (claude-api skill, cached 2026-10-06), so keyloom never rewrites stored messages.

### Retention and deletion

Everything is local and kept until BK deletes it. `keyloom config delete <id> <name>` requires the config's name and refuses the active config or one a sync is using. It removes the config and its related database history (D-308); `layout delete` is not an implemented alias. Do not assume this command securely erases exported files, logs or every artifact on disk. There's no multi-tenant isolation: one database belongs to one OS user.
