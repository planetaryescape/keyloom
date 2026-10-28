// What only a software remapper's layout can get wrong (21, D-235). A MacBook's built-in keyboard is the one keyboard BK
// can't reach for another of, so the rules here protect his way out, and refuse what kanata can't express instead of
// letting the generator fail at Apply time.
import type { BoardDefinition } from "../boards/schema.ts";
import type { Slot } from "../layout/change.ts";
import { GenerateError } from "../layout/kanata/generate-error.ts";
import { macroAction } from "../layout/kanata/macro.ts";
import { keyName } from "../layout/kanata/names.ts";
import { nativeAction } from "../layout/kanata/natives.ts";
import { readKanataProfile } from "../layout/kanata/profiles.ts";
import type { Binding, Layout } from "../layout/schema.ts";
import type { Issue } from "./result.ts";
import { functionHomes, reachableLayers } from "./reachability.ts";
import { keyOn } from "./words.ts";

const issue = (code: string, message: string, plain: string, slots?: Slot[]): Issue => (slots?.length ? { code, message, plain, slots } : { code, message, plain });

/** `firmware_unsupported` for what kanata can't write: a key kanata can't send on macOS, a macro that holds a non-modifier, a kept binding that runs a command. */
export function kanataSupport(doc: Layout): Issue[] {
  if (doc.firmware !== "kanata") return [];
  const out: Issue[] = [];
  const attempt = (fn: () => unknown, slot?: Slot, who?: string) => {
    try {
      fn();
    } catch (err) {
      if (!(err instanceof GenerateError)) throw err;
      out.push(issue("firmware_unsupported", err.message, `${who ?? (slot ? keyOn(doc, slot) : "A key")}: ${err.message}`, slot ? [slot] : undefined));
    }
  };
  for (const layer of doc.layers) {
    for (const [position, b] of layer.bindings.entries()) {
      const slot = { layerId: layer.id, position };
      if (b.kind === "native" && b.firmware === "kanata") attempt(() => nativeAction("kanata", b.source, `layer "${layer.id}", position ${position}`), slot);
      if (b.kind === "key") attempt(() => keyName(b.code), slot);
      if (b.kind === "holdTap" && b.tap.macroId === undefined) attempt(() => keyName(b.tap.code), slot);
    }
  }
  for (const combo of doc.combos) {
    const output = combo.output;
    if (output.kind === "native" && output.firmware === "kanata") attempt(() => nativeAction("kanata", output.source, `combo "${combo.id}"`), undefined, `Combo "${combo.name}"`);
    if (output.kind === "key") attempt(() => keyName(output.code), undefined, `Combo "${combo.name}"`);
  }
  for (const dance of doc.tapDances) {
    for (const slot of [dance.tap, dance.hold, dance.doubleTap, dance.tapThenHold]) {
      if (slot?.kind === "key") attempt(() => keyName(slot.code), undefined, `Tap dance "${dance.name}"`);
    }
  }
  for (const m of doc.macros) attempt(() => macroAction(m), undefined, `Macro "${m.name}"`);
  return out;
}

/** `firmware_unsupported` for kanata hold-tap profiles with options the generator would refuse. */
export function kanataProfileOptions(doc: Layout): Issue[] {
  const out: Issue[] = [];
  for (const profile of doc.holdTapProfiles.filter((p) => p.firmware === "kanata")) {
    const read = readKanataProfile(profile);
    if (!read.ok) {
      out.push(issue("firmware_unsupported", `hold-tap profile "${profile.id}": ${read.problems.join("; ")}`, `The hold-tap timing profile "${profile.name}" has a setting the MacBook's remapper can't read: ${read.problems.join("; ")}.`));
    }
  }
  return out;
}

const ESCAPE = "key:ESCAPE";
const CONTROLS = ["mod:LCTL", "mod:RCTL", "key:LEFT_CTRL", "key:RIGHT_CTRL"];

/**
 * `remapper_lockout`: Esc and a Control key must stay reachable on the built-in keyboard. kanata's own exit chord (Left
 * Control + Space + Escape) reads the raw keys, so it works whatever this says; this keeps the keys themselves reachable,
 * so a mistaken layout never leaves BK typing without a way to escape a prompt or use Control.
 */
export function remapperLockout(board: BoardDefinition, doc: Layout): Issue[] {
  if (board.firmware !== "kanata" || doc.firmware !== "kanata") return [];
  const homes = functionHomes(doc, reachableLayers(doc));
  const out: Issue[] = [];
  if (!homes.has(ESCAPE)) {
    out.push(issue("remapper_lockout", "Escape is not reachable on the built-in keyboard", "This layout has no Escape key you can reach. Keep Escape on the MacBook so you can always back out of a prompt."));
  }
  if (!CONTROLS.some((c) => homes.has(c))) {
    out.push(issue("remapper_lockout", "no Control key is reachable on the built-in keyboard", "This layout has no Control key you can reach. Keep Control on the MacBook; the emergency exit also needs it."));
  }
  return out;
}
