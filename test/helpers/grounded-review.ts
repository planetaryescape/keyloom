// Synthetic custom hold/tap, intentionally not named Magic: diagnoses must follow source, not familiar labels.
import type { ChangeOp } from "../../src/layout/change.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { none, tinyLayout, workloadApp } from "./workload.ts";

export function groundedLayout(): Layout {
  const layout = tinyLayout();
  layout.boardId = "moergo/glove80"; layout.firmware = "zmk";
  const native = { kind: "native", firmware: "zmk", source: "&mode 2 0", label: "Sticky Magic", layerRefs: [{ start: 6, end: 7, layerId: "factory" }] } as const;
  layout.layers = [
    { id: "base", name: "Base", bindings: [{ ...native, layerRefs: [...native.layerRefs] }, { kind: "key", code: "A" }, none, none] },
    { id: "tools", name: "Tools", bindings: [none, { kind: "key", code: "B" }, none, none] },
    { id: "factory", name: "Factory", bindings: [none, { kind: "key", code: "C" }, none, none] },
  ];
  layout.passthrough = [
    { firmware: "zmk", file: "synthetic.keymap", anchor: "behavior:mode", refersToLayerIndices: false,
      source: 'mode: dual { compatible = "zmk,behavior-hold-tap"; #binding-cells = <2>; flavor = "tap-preferred"; tapping-term-ms = <200>; bindings = <&mo>, <&indicator>; };' },
    { firmware: "zmk", file: "synthetic.keymap", anchor: "macro:indicator", refersToLayerIndices: false,
      source: 'indicator: status { compatible = "zmk,behavior-macro"; #binding-cells = <0>; bindings = <&rgb_ug RGB_STATUS>; };' },
  ];
  return layout;
}

export const groundedWorld = () => workloadApp(groundedLayout());
export const retargetMode = (): ChangeOp[] => [
  { op: "setBinding", at: { layerId: "base", position: 0 }, binding: { kind: "native", firmware: "zmk", source: "&mode 1 0", label: "Mode", layerRefs: [{ start: 6, end: 7, layerId: "tools" }] } },
  { op: "setBinding", at: { layerId: "tools", position: 2 }, binding: { kind: "layer", action: "momentary", layerId: "factory" } },
  { op: "dropFunction", function: "native:zmk:&mode 2 0", reason: "Retarget the hold, preserving its tap." },
];
