import { openApp, getLayout, proposeChange, applyChange } from "../../src/app/index.ts";
import { newConfig } from "../../src/app/configs.ts";
import { recordPriority } from "../../src/app/decisions.ts";
import { previewPut } from "../../src/app/keyboard-put.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import type { Binding } from "../../src/layout/schema.ts";
import { tempDir } from "./tmp.ts";

/** Synthetic layout: a Glove80-only thumb needs a reachable home on the smaller Corne. */
export function copyAdaptationApp() {
  const dir = tempDir("copy-adaptation-");
  const app = openApp({ dataDir: dir });
  const blank = newConfig(app, { name: "Synthetic source blank", from: "blank", board: "moergo/glove80" });
  const document = getLayout(app, blank.id).document;
  const bindings: Binding[] = Array.from({ length: 80 }, () => ({ kind: "none" }));
  bindings[22] = { kind: "key", code: "ESCAPE" };
  bindings[24] = { kind: "key", code: "A" };
  bindings[34] = { kind: "modifier", mods: ["LCTL"] };
  bindings[57] = { kind: "layer", action: "momentary", layerId: "navigation" };
  const nav: Binding[] = Array.from({ length: 80 }, () => ({ kind: "transparent" }));
  nav[24] = { kind: "key", code: "LEFT" };
  const source = createLayout(app.db, { name: "Synthetic source", layout: { ...document, layers: [{ id: "base", name: "Base", bindings }, { id: "navigation", name: "Navigation", bindings: nav }] }, summary: "Synthetic cross-board adaptation", origin: "import" }).layout;
  const target = newConfig(app, { name: "Synthetic target", from: "blank", board: "foostan/corne" });
  const space = proposeChange(app, target.id, { source: "editor", explanation: "Synthetic target uses inner-thumb Space", ops: [{ op: "setBinding", at: { layerId: "base", position: 38 }, binding: { kind: "key", code: "SPACE" } }] });
  applyChange(app, space.id);
  recordPriority(app, source.id, { priorityKind: "frequent", statement: "Keep Navigation in my left hand; my right hand uses the mouse", subject: { functions: ["layer:navigation"] }, sourceMessageIds: [] });
  recordPriority(app, target.id, { priorityKind: "pinned", statement: "Reserve the inner left thumb for Space; use the middle left thumb for layer access", subject: { slots: [{ layerId: "base", position: 38 }] }, sourceMessageIds: [] });
  const preview = previewPut(app, { from: source.id, board: target.boardId });
  return { app, dir, sourceId: source.id, targetId: target.id, preview };
}
