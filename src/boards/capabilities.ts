// What a board can do that a layout may ask for, as facts the agent and the validator quote
// (20#capabilities). The model holds all of these for both firmwares except per-key colours, which
// need a LED table in board.json, so the one thing that varies by board is lighting.
import type { BoardDefinition } from "./schema.ts";

export type Capability = { supported: boolean; /** Why not, in a sentence people can read; present when unsupported. */ because?: string };

export type BoardCapabilities = {
  lighting: Capability;
  combos: Capability;
  tapDance: Capability;
  macros: Capability;
  holdTap: Capability;
};

const DEFAULT_LIGHTING_LIMIT = "keyloom does not write per-key lighting for this board";

export function boardCapabilities(def: BoardDefinition): BoardCapabilities {
  const yes: Capability = { supported: true };
  return {
    lighting: def.lighting === undefined ? { supported: false, because: def.limits?.lighting ?? DEFAULT_LIGHTING_LIMIT } : yes,
    combos: yes,
    tapDance: yes,
    macros: yes,
    holdTap: yes,
  };
}

/** The sentence for a refused colour edit: the board's own words, no firmware vocabulary beyond what its limit says. */
export const lightingRefusal = (def: BoardDefinition): string => `${def.name} can't show per-key colours because ${boardCapabilities(def).lighting.because ?? DEFAULT_LIGHTING_LIMIT}.`;

/** One line for the agent: what the board supports, and the reason for what it doesn't. */
export function capabilityLine(def: BoardDefinition): string {
  const caps = boardCapabilities(def);
  const names: Record<keyof BoardCapabilities, string> = { lighting: "per-key colours", combos: "combos", tapDance: "tap dance", macros: "macros", holdTap: "hold-taps" };
  const on = (Object.keys(names) as (keyof BoardCapabilities)[]).filter((k) => caps[k].supported).map((k) => names[k]);
  const off = (Object.keys(names) as (keyof BoardCapabilities)[]).filter((k) => !caps[k].supported).map((k) => `${names[k]} (${caps[k].because})`);
  return `Can do: ${on.join(", ")}.${off.length ? ` Cannot do: ${off.join("; ")}.` : ""}`;
}
