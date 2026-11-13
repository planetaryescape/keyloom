// A one-shot modifier as the key editor makes it (D-568): modifiers held for the next key only, written as the layout's own firmware
// spells it (`OSM(MOD_LSFT)`, `&sk LSHFT`, `(one-shot 2000 lshift)`) by the same writer a copy uses (native-write.ts). The model has no
// one-shot modifier kind, so the key is a `native` binding the validator admits because keyloom reads it (D-451). Pure.
import type { KeptMap } from "./native-read.ts";
import { readNative } from "./native-read.ts";
import { MOD_ORDER } from "./native-meaning.ts";
import { type TargetFacts, writeSteps } from "./native-write.ts";
import type { Binding, Firmware, Mod } from "./schema.ts";

type Native = Extract<Binding, { kind: "native" }>;

// A one-shot reads nothing about the board: no lighting, no Bluetooth. The writer takes facts for the steps that do.
const NO_FACTS: TargetFacts = { board: "this keyboard", lighting: { supported: false }, bluetooth: false };

/** The native binding for `mods` held for the next key only on `firmware`, or why that firmware can't hold them. */
export function writeOneShot(mods: readonly Mod[], firmware: Firmware, kept?: KeptMap): { binding: Native } | { why: string } {
  if (mods.length === 0) return { why: "there is no modifier to hold" };
  if (firmware === "zmk" && kept?.has("sk")) return { why: "This layout replaces ZMK’s sticky-key behaviour. Keep its native binding or use a plain modifier" };
  const written = writeSteps([{ kind: "oneShot", mods: [...mods] }], firmware, NO_FACTS);
  return "why" in written ? written : { binding: { kind: "native", firmware, source: written.source, label: written.label } };
}

/**
 * The modifiers a native binding holds for the next key, or null when it is anything else. Only firmware built-ins count: a kept
 * behaviour that reads as a one-shot (a sticky key with its own timing) has settings the editor would drop, so it stays a kept key.
 */
export function oneShotModsOf(binding: Binding, kept: KeptMap): Mod[] | null {
  if (binding.kind !== "native") return null;
  const name = /^&(\w+)\b/.exec(binding.source.trim())?.[1];
  if (name !== undefined && kept.has(name)) return null;
  const builtin = readNative(binding, new Map());
  const [step] = builtin.kind === "steps" && builtin.steps.length === 1 ? builtin.steps : [];
  if (step?.kind !== "oneShot") return null;
  return MOD_ORDER.filter((m) => step.mods.includes(m));
}

/**
 * Why `mods` can't be held for the next key on `firmware`, in words for the key card, with what to do instead; null when they can.
 * The test is the writer's own refusal, so the card never offers what the writer then refuses.
 */
export function oneShotRefusal(mods: readonly Mod[], firmware: Firmware, kept?: KeptMap): string | null {
  const written = writeOneShot(mods, firmware, kept);
  if (!("why" in written)) return null;
  if (mods.length === 0) return "Turn on a modifier first.";
  const name = { qmk: "QMK", zmk: "ZMK", kanata: "kanata" }[firmware];
  if (firmware !== "qmk" && mods.length > 1) return `${name} holds one modifier for the next key. Turn off all but one to use this.`;
  const left = mods.some((m) => m.startsWith("L"));
  const right = mods.some((m) => m.startsWith("R"));
  if (firmware === "qmk" && left && right) return "QMK holds left-hand or right-hand modifiers for the next key, not both. Use one side to use this.";
  return `${written.why.charAt(0).toUpperCase()}${written.why.slice(1)}.`;
}
