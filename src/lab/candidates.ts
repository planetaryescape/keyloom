// The settings worth trying on a recording (D-282): per hold-tap profile the tapping term in steps, permissive hold, hold on other key
// press, chordal hold, flavors, quick tap and require-prior-idle, each as an ordinary change (ops) so what is tried is exactly what a
// suggestion proposes. Which firmware spells a setting how is decided here, once.
import type { BoardDefinition } from "../boards/schema.ts";
import { OPTIONS } from "../layout/firmware-options.ts";
import type { ChangeOp } from "../layout/change.ts";
import type { HoldTapProfile, Layout } from "../layout/schema.ts";
import { BUILTIN_OPTIONS } from "../firmware/zmk/builtins.ts";

export type CandidateScope = { kind: "profile"; profileId: string } | { kind: "layout" };

export type Candidate = {
  id: string;
  scope: CandidateScope;
  /** In plain words, for the proposal card: "Raise the tapping term of Home row mods from 200 to 240 ms". */
  title: string;
  ops: ChangeOp[];
  /** Candidates that change the same thing in different amounts share a family, so the fine search can refine the best one. */
  family: string;
  /** For a numeric family: the value tried. */
  value?: number;
  /**
   * The option changes of a candidate that only edits one profile's options. Two of these on one profile merge into one edit, which two
   * ready-made upsert ops could not (the second would put back what the first changed).
   */
  patch?: { profileId: string; set: Record<string, HoldTapProfile["options"][string]> };
};

/** What the recording's misfires lean toward, which decides what is worth trying first. */
export type Bias = { hold: number; tap: number };

const TERM_STEPS = [40, 80, 120];
const QMK_TERM = OPTIONS.find((o) => o.firmware === "qmk" && o.key === "TAPPING_TERM") as Extract<(typeof OPTIONS)[number], { kind: "number" }>;
const clampTerm = (ms: number): number => Math.min(QMK_TERM.max, Math.max(QMK_TERM.min, ms));
const DEFAULT_TERM = 200;
/** QMK's own recommendation for Flow Tap, and ZMK's for require-prior-idle. */
const IDLE_MS = 150;
const QUICK_TAP_MS = 120;

const qmkGlobal = (layout: Layout, key: string): number | boolean | string | undefined => layout.settings.find((s) => s.firmware === "qmk" && s.key === key)?.value;

export function profileOf(layout: Layout, profileId: string): HoldTapProfile | undefined {
  return layout.holdTapProfiles.find((p) => p.id === profileId);
}

/** What a profile's option is in force: its own, else (QMK) the layout-wide setting, else (ZMK) the built-in's, else the default. */
function effective(layout: Layout, board: BoardDefinition, profile: HoldTapProfile, key: string): number | boolean | string | readonly number[] | undefined {
  const own = profile.options[key];
  if (own !== undefined) return own;
  if (profile.firmware === "qmk") return qmkGlobal(layout, key) ?? board.settingDefaults?.[key];
  return BUILTIN_OPTIONS[profile.id]?.[key];
}

const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback);

const upsert = (profile: HoldTapProfile, options: Record<string, HoldTapProfile["options"][string]>): ChangeOp => ({
  op: "upsertHoldTapProfile",
  profile: { ...profile, options: { ...profile.options, ...options } },
});

/** The fields a candidate that edits one profile's options carries: its ops, and the patch they come from. */
const edit = (profile: HoldTapProfile, set: Record<string, HoldTapProfile["options"][string]>): Pick<Candidate, "ops" | "patch"> => ({
  ops: [upsert(profile, set)],
  patch: { profileId: profile.id, set },
});

/** The ops of several candidates at once: edits to one profile become one upsert, the rest follow as they are. */
export function opsOf(layout: Layout, candidates: readonly Candidate[]): ChangeOp[] {
  const patches = new Map<string, Record<string, HoldTapProfile["options"][string]>>();
  const rest: ChangeOp[] = [];
  for (const c of candidates) {
    if (c.patch) patches.set(c.patch.profileId, { ...(patches.get(c.patch.profileId) ?? {}), ...c.patch.set });
    else rest.push(...c.ops);
  }
  const edits = [...patches].flatMap(([id, set]) => {
    const profile = profileOf(layout, id);
    return profile ? [upsert(profile, set)] : [];
  });
  return [...edits, ...rest];
}

function termCandidates(layout: Layout, board: BoardDefinition, profile: HoldTapProfile, bias: Bias): Candidate[] {
  const key = profile.firmware === "qmk" ? "TAPPING_TERM" : "tapping-term-ms";
  const from = num(effective(layout, board, profile, key), DEFAULT_TERM);
  const upSteps = TERM_STEPS.map((s) => from + s);
  const downSteps = TERM_STEPS.map((s) => from - s);
  const order = bias.hold >= bias.tap ? [upSteps, downSteps] : [downSteps, upSteps];
  // The dominant direction first, and the other only when the recording shows the opposite misfire too.
  const targets = [...order[0] as number[], ...(bias.hold > 0 && bias.tap > 0 ? (order[1] as number[]) : [])];
  return targets
    .map(clampTerm)
    .filter((to, i, all) => to !== from && all.indexOf(to) === i)
    .map((to) => ({
      id: `${profile.id}:term:${to}`,
      scope: { kind: "profile", profileId: profile.id } as const,
      title: `${to > from ? "Raise" : "Lower"} the tapping term of ${profile.name} from ${from} to ${to} ms`,
      ...edit(profile, { [key]: to }),
      family: `${profile.id}:term`,
      value: to,
    }));
}

function qmkFlagCandidates(layout: Layout, board: BoardDefinition, profile: HoldTapProfile, bias: Bias): Candidate[] {
  const out: Candidate[] = [];
  const flag = (key: string, label: string, on: boolean) => {
    const verb = on ? "Turn on" : "Turn off";
    out.push({
      id: `${profile.id}:${key}:${on}`, scope: { kind: "profile", profileId: profile.id }, title: `${verb} ${label} for ${profile.name}`,
      ...edit(profile, { [key]: on }), family: `${profile.id}:${key}`,
    });
  };
  const holdOnOther = effective(layout, board, profile, "HOLD_ON_OTHER_KEY_PRESS") === true;
  const permissive = effective(layout, board, profile, "PERMISSIVE_HOLD") === true;
  if (bias.hold > 0) {
    if (holdOnOther) flag("HOLD_ON_OTHER_KEY_PRESS", "hold on other key press", false);
    if (permissive) flag("PERMISSIVE_HOLD", "permissive hold", false);
  }
  if (bias.tap > 0) {
    if (!permissive) flag("PERMISSIVE_HOLD", "permissive hold", true);
    if (!holdOnOther) flag("HOLD_ON_OTHER_KEY_PRESS", "hold on other key press", true);
  }
  const term = num(effective(layout, board, profile, "TAPPING_TERM"), DEFAULT_TERM);
  const quick = effective(layout, board, profile, "QUICK_TAP_TERM");
  if (bias.hold > 0 && quick === undefined && QUICK_TAP_MS < term) {
    out.push({
      id: `${profile.id}:QUICK_TAP_TERM:${QUICK_TAP_MS}`, scope: { kind: "profile", profileId: profile.id },
      title: `Make a key you tap again within ${QUICK_TAP_MS} ms always a tap for ${profile.name}`, ...edit(profile, { QUICK_TAP_TERM: QUICK_TAP_MS }),
      family: `${profile.id}:QUICK_TAP_TERM`, value: QUICK_TAP_MS,
    });
  }
  return out;
}

const FLAVORS = ["tap-preferred", "balanced", "hold-preferred"] as const;
const FLAVOR_WORDS: Record<string, string> = {
  "tap-preferred": "tap-preferred (a hold only after the full tapping term)",
  balanced: "balanced (a hold when another key is pressed and released inside the term)",
  "hold-preferred": "hold-preferred (a hold as soon as another key is pressed)",
};

function zmkFlagCandidates(layout: Layout, board: BoardDefinition, profile: HoldTapProfile, bias: Bias): Candidate[] {
  const out: Candidate[] = [];
  const current = String(effective(layout, board, profile, "flavor") ?? "hold-preferred");
  // Away from the flavor that is eager when holds fire too often, and toward it when taps win too often.
  const wanted = FLAVORS.filter((f) => f !== current && ((bias.hold > 0 && FLAVORS.indexOf(f) < FLAVORS.indexOf(current as (typeof FLAVORS)[number])) || (bias.tap > 0 && FLAVORS.indexOf(f) > FLAVORS.indexOf(current as (typeof FLAVORS)[number]))));
  for (const f of wanted) {
    out.push({
      id: `${profile.id}:flavor:${f}`, scope: { kind: "profile", profileId: profile.id }, title: `Switch ${profile.name} to the ${FLAVOR_WORDS[f]} flavor`,
      ...edit(profile, { flavor: f }), family: `${profile.id}:flavor`,
    });
  }
  if (bias.hold > 0) {
    if (num(effective(layout, board, profile, "require-prior-idle-ms"), -1) < IDLE_MS) {
      out.push({
        id: `${profile.id}:require-prior-idle-ms:${IDLE_MS}`, scope: { kind: "profile", profileId: profile.id },
        title: `Make ${profile.name} keys taps for ${IDLE_MS} ms after any other key (require prior idle)`, ...edit(profile, { "require-prior-idle-ms": IDLE_MS }),
        family: `${profile.id}:require-prior-idle-ms`, value: IDLE_MS,
      });
    }
    if (num(effective(layout, board, profile, "quick-tap-ms"), -1) < 0) {
      out.push({
        id: `${profile.id}:quick-tap-ms:${QUICK_TAP_MS}`, scope: { kind: "profile", profileId: profile.id },
        title: `Make a key you tap again within ${QUICK_TAP_MS} ms always a tap for ${profile.name}`, ...edit(profile, { "quick-tap-ms": QUICK_TAP_MS }),
        family: `${profile.id}:quick-tap-ms`, value: QUICK_TAP_MS,
      });
    }
  }
  return out;
}

/**
 * ZMK's chordal hold is a list of the keys that may complete a hold, and one hold-tap has one list, so a profile used on both hands becomes
 * two: each key is rebound to the copy whose list is the other hand. Every layer's keys on the profile move, so the change is the same
 * everywhere it is used.
 */
function zmkChordalCandidate(layout: Layout, board: BoardDefinition, profile: HoldTapProfile): Candidate | undefined {
  if (profile.options["hold-trigger-key-positions"] !== undefined) return undefined;
  const left = new Set(board.hands.left);
  const base = { ...(BUILTIN_OPTIONS[profile.id] ?? {}), ...profile.options };
  const ids = { left: `${profile.id}-left`, right: `${profile.id}-right` };
  if (layout.holdTapProfiles.some((p) => p.id === ids.left || p.id === ids.right)) return undefined;
  const uses = layout.layers.flatMap((layer) =>
    layer.bindings.flatMap((b, position) => (b.kind === "holdTap" && b.profileId === profile.id ? [{ layerId: layer.id, position, binding: b }] : [])),
  );
  if (uses.length === 0) return undefined;
  const hands = { left: uses.filter((u) => left.has(u.position)), right: uses.filter((u) => !left.has(u.position)) };
  const ops: ChangeOp[] = [];
  // ZMK notes the first other key at its release when hold-trigger-on-release is set, but a hold-preferred key is decided when that key goes
  // down, before any release: the positional check then sees nothing and the hold stands (seen on the Glove80's build, 2026-10-16). The
  // flavors that wait for a release are the ones it is for.
  const onRelease = String(base.flavor ?? "hold-preferred") !== "hold-preferred";
  const { "hold-trigger-on-release": _was, ...rest } = base;
  for (const hand of ["left", "right"] as const) {
    if (hands[hand].length === 0) continue;
    // A key on the left hand is completed by a key on the right.
    const triggers = hand === "left" ? board.hands.right : board.hands.left;
    ops.push({
      op: "upsertHoldTapProfile",
      profile: {
        id: ids[hand], name: `${profile.name} (${hand} hand)`, firmware: "zmk",
        options: { ...rest, "hold-trigger-key-positions": [...triggers], ...(onRelease ? { "hold-trigger-on-release": true } : {}) },
      },
    });
  }
  for (const hand of ["left", "right"] as const) {
    for (const u of hands[hand]) ops.push({ op: "setBinding", at: { layerId: u.layerId, position: u.position }, binding: { ...u.binding, profileId: ids[hand] } });
  }
  return {
    id: `${profile.id}:chordal`, scope: { kind: "profile", profileId: profile.id }, family: `${profile.id}:chordal`,
    title: `Let ${profile.name} keys hold only when the next key is on the other hand (chordal hold)`, ops,
  };
}

function qmkLayoutWide(layout: Layout, bias: Bias): Candidate[] {
  const out: Candidate[] = [];
  const chordal = qmkGlobal(layout, "CHORDAL_HOLD") === true;
  if (bias.hold > 0 && !chordal) {
    out.push({
      id: "layout:CHORDAL_HOLD:on", scope: { kind: "layout" }, family: "layout:CHORDAL_HOLD",
      title: "Turn on chordal hold: a tap-hold key only holds when the next key is on the other hand",
      ops: [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "CHORDAL_HOLD", value: true } }],
    });
  }
  if (bias.tap > 0 && chordal) {
    out.push({
      id: "layout:CHORDAL_HOLD:off", scope: { kind: "layout" }, family: "layout:CHORDAL_HOLD", title: "Turn off chordal hold",
      ops: [{ op: "removeFirmwareSetting", firmware: "qmk", key: "CHORDAL_HOLD" }],
    });
  }
  if (bias.hold > 0 && qmkGlobal(layout, "FLOW_TAP_TERM") === undefined) {
    out.push({
      id: `layout:FLOW_TAP_TERM:${IDLE_MS}`, scope: { kind: "layout" }, family: "layout:FLOW_TAP_TERM", value: IDLE_MS,
      title: `Make tap-hold keys taps for ${IDLE_MS} ms after any other key (flow tap)`,
      ops: [{ op: "setFirmwareSetting", setting: { firmware: "qmk", key: "FLOW_TAP_TERM", value: IDLE_MS } }],
    });
  }
  return out;
}

/** Interleaves lists so a budget that cuts the end still tries a bit of everything. */
function interleave<T>(lists: readonly T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i] as T);
  return out;
}

/** The candidates for one profile, most promising first. */
export function profileCandidates(layout: Layout, board: BoardDefinition, profileId: string, bias: Bias): Candidate[] {
  const profile = profileOf(layout, profileId);
  if (!profile || profile.firmware === "kanata") return [];
  const flags = profile.firmware === "qmk" ? qmkFlagCandidates(layout, board, profile, bias) : zmkFlagCandidates(layout, board, profile, bias);
  const chordal = profile.firmware === "zmk" && bias.hold > 0 ? [zmkChordalCandidate(layout, board, profile)].filter((c): c is Candidate => c !== undefined) : [];
  return interleave([termCandidates(layout, board, profile, bias), chordal, flags]);
}

/** Candidates that change a setting every profile shares, tried one at a time. */
export function layoutCandidates(layout: Layout, board: BoardDefinition, bias: Bias): Candidate[] {
  return board.firmware === "qmk" ? qmkLayoutWide(layout, bias) : [];
}

/** A numeric candidate's neighbours at half the coarse step, for the fine search around the best coarse one. */
export function refine(layout: Layout, board: BoardDefinition, best: Candidate, step = 20): Candidate[] {
  if (best.scope.kind !== "profile" || best.value === undefined || !best.family.endsWith(":term")) return [];
  const profile = profileOf(layout, best.scope.profileId);
  if (!profile) return [];
  const key = profile.firmware === "qmk" ? "TAPPING_TERM" : "tapping-term-ms";
  const from = num(effective(layout, board, profile, key), DEFAULT_TERM);
  return [best.value - step, best.value + step]
    .map(clampTerm)
    .filter((to, i, list) => to !== from && to !== best.value && list.indexOf(to) === i)
    .map((to) => ({
      id: `${profile.id}:term:${to}`, scope: best.scope, family: best.family, value: to,
      title: `${to > from ? "Raise" : "Lower"} the tapping term of ${profile.name} from ${from} to ${to} ms`, ...edit(profile, { [key]: to }),
    }));
}
