// What a board can do that a layout may ask for, as facts the agent and the validator quote
// (20#capabilities). The model holds all of these for both firmwares except per-key hardware LED colours, which
// need a LED table in board.json, so the one thing that varies by board is lighting.
import type { BoardDefinition } from "./schema.ts";

export type Capability = { supported: boolean; /** Why not, in a sentence people can read; present when unsupported. */ because?: string };

export type BoardCapabilities = {
  /** keyloom's on-screen layer colours and labels, independent of physical LEDs. */
  layerStyle: Capability;
  /** Physical per-key LED output supported by this board's firmware adapter. */
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
    layerStyle: yes,
    lighting: def.lighting === undefined ? { supported: false, because: def.limits?.lighting ?? DEFAULT_LIGHTING_LIMIT } : yes,
    combos: yes,
    tapDance: yes,
    macros: yes,
    holdTap: yes,
  };
}

/** The sentence for a refused physical LED edit; it does not limit keyloom's display styling. */
/** Why a board can't take a lighting-control key (RGB underglow or RGB matrix controls) when nothing in its layout shows the firmware has them. */
export const lightingControlsRefusal = (def: BoardDefinition): string => `keyloom can't tell that the ${def.name}'s firmware has lighting controls, because nothing in this config uses them`;

export const lightingRefusal = (def: BoardDefinition): string => `${def.name} can't show per-key hardware LED colours because ${boardCapabilities(def).lighting.because ?? DEFAULT_LIGHTING_LIMIT}.`;

/** One line for the agent: what the board supports, and the reason for what it doesn't. */
export function capabilityLine(def: BoardDefinition): string {
  const { layerStyle, ...caps } = boardCapabilities(def);
  const features = [
    { name: "per-key hardware LED colours", ...caps.lighting },
    { name: "combos", ...caps.combos },
    { name: "tap dance", ...caps.tapDance },
    { name: "macros", ...caps.macros },
    { name: "hold-taps", ...caps.holdTap },
  ];
  const on = features.filter((feature) => feature.supported).map((feature) => feature.name);
  const off = features.filter((feature) => !feature.supported).map((feature) => `${feature.name} (${feature.because})`);
  return `${layerStyle.supported ? "On-screen: layer colours and short labels (setLayerStyle; not keyboard LEDs). " : ""}Can do: ${on.join(", ")}.${off.length ? ` Cannot do: ${off.join("; ")}.` : ""}`;
}
