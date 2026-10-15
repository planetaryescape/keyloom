// Binding -> the text of one ZMK binding, `&kp LC(A)` (06#generation-writes-glove80keymap-and-glove80conf).
import type { Binding, Mod } from "../../layout/schema.ts";
import { GenerateError } from "./generate-error.ts";
import { keyExprText } from "./key-expr.ts";

export type EmitContext = {
  layerIndex: ReadonlyMap<string, number>;
  /** Profile id to the devicetree label its uses are written with. */
  profileLabels: ReadonlyMap<string, string>;
  macroLabels: ReadonlyMap<string, string>;
};

const LAYER_BEHAVIOR = { momentary: "mo", toggle: "tog", to: "to", oneShot: "sl" } as const;

/** A label or node name devicetree accepts: letters, digits and underscores. */
export const labelOf = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, "_");

function layer(id: string, ctx: EmitContext): number {
  const i = ctx.layerIndex.get(id);
  if (i === undefined) throw new GenerateError(`it refers to layer "${id}", which doesn't exist`);
  return i;
}

function key(e: { code?: string; mods?: readonly Mod[] }): string {
  try {
    return keyExprText(e);
  } catch (err) {
    throw new GenerateError((err as Error).message);
  }
}

export function bindingToDts(b: Binding, ctx: EmitContext): string {
  switch (b.kind) {
    case "key":
      return `&kp ${key({ code: b.code, ...(b.mods ? { mods: b.mods } : {}) })}`;
    case "modifier":
      return `&kp ${key({ mods: b.mods })}`;
    case "holdTap": {
      const label = ctx.profileLabels.get(b.profileId);
      if (!label) throw new GenerateError(`it uses the hold-tap profile "${b.profileId}", which doesn't exist`);
      const hold = "mods" in b.hold ? key({ mods: b.hold.mods }) : String(layer(b.hold.layerId, ctx));
      return `&${label} ${hold} ${key({ code: b.tap.code, ...(b.tap.mods ? { mods: b.tap.mods } : {}) })}`;
    }
    case "layer":
      return `&${LAYER_BEHAVIOR[b.action]} ${layer(b.layerId, ctx)}`;
    case "macro": {
      const label = ctx.macroLabels.get(b.macroId);
      if (!label) throw new GenerateError(`it uses the macro "${b.macroId}", which doesn't exist`);
      return `&${label}`;
    }
    case "transparent":
      return "&trans";
    case "none":
      return "&none";
    case "native":
      if (b.firmware !== "zmk") throw new GenerateError(`it is a ${b.firmware} binding (${b.source}), which a ZMK board can't use`);
      return b.source;
  }
}
