// The validator reports functions as canonical strings (key:LEFT+LCTL, layer:toggle:layer-4). People
// read the same legends the board shows, so this turns one into the other for the diff lines.
import { modsText, tapText } from "../../layout/render-grid.ts";
import type { Layout, Mod } from "../../layout/schema.ts";

const LAYER_ACTION: Readonly<Record<string, string>> = { momentary: "Hold", toggle: "Toggle", to: "Go to", oneShot: "One-shot" };

export function functionLabel(fn: string, layout: Layout): string {
  const [kind, ...rest] = fn.split(":");
  const body = rest.join(":");
  switch (kind) {
    case "key": {
      const [code = body, ...mods] = body.split("+");
      return tapText(code, mods.length ? (mods as Mod[]) : undefined);
    }
    case "mod":
      return `Hold ${modsText(body.split("+") as Mod[])}`;
    case "layer": {
      const [action = "", layerId = ""] = rest;
      const name = layout.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
      return `${LAYER_ACTION[action] ?? action} ${name}`;
    }
    case "macro":
      return layout.macros.find((macro) => macro.id === body)?.name ?? `Macro ${body}`;
    case "native":
      return "A native binding";
    default:
      return fn;
  }
}
