// Binding -> the text of one ZMK binding, `&kp LC(A)` (06#generation-writes-glove80keymap-and-glove80conf).
import type { Binding, Mod } from "../../layout/schema.ts";
import { GenerateError } from "./generate-error.ts";
import { keyExprText } from "./key-expr.ts";

export type EmitContext = {
  layerIndex: ReadonlyMap<string, number>;
  /** A layer's `#define`d name, when kept source defines one (D-360); keys are written with it so the define stays what the keymap reads. */
  layerNames?: ReadonlyMap<string, string>;
  /** Profile id to the devicetree label its uses are written with. */
  profileLabels: ReadonlyMap<string, string>;
  macroLabels: ReadonlyMap<string, string>;
  /** Tap dance ID to the label of its `zmk,behavior-tap-dance` node. */
  tapDanceLabels: ReadonlyMap<string, string>;
};

const LAYER_BEHAVIOR = { momentary: "mo", toggle: "tog", to: "to", oneShot: "sl" } as const;

/** A label or node name devicetree accepts: letters, digits and underscores. */
export const labelOf = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, "_");

function layer(id: string, ctx: EmitContext): string {
  const i = ctx.layerIndex.get(id);
  if (i === undefined) throw new GenerateError(`it refers to layer "${id}", which doesn't exist`);
  return ctx.layerNames?.get(id) ?? String(i);
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
      const hold = "mods" in b.hold ? key({ mods: b.hold.mods }) : layer(b.hold.layerId, ctx);
      const tap = b.tap.macroId !== undefined
        ? `&${ctx.macroLabels.get(b.tap.macroId) ?? b.tap.macroId}`
        : key({ code: b.tap.code, ...(b.tap.mods ? { mods: b.tap.mods } : {}) });
      return `&${label} ${hold} ${tap}`;
    }
    case "layer":
      return `&${LAYER_BEHAVIOR[b.action]} ${layer(b.layerId, ctx)}`;
    case "macro": {
      const label = ctx.macroLabels.get(b.macroId);
      if (!label) throw new GenerateError(`it uses the macro "${b.macroId}", which doesn't exist`);
      return `&${label}`;
    }
    case "tapDance": {
      const label = ctx.tapDanceLabels.get(b.tapDanceId);
      if (!label) throw new GenerateError(`it uses the tap dance "${b.tapDanceId}", which doesn't exist`);
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
