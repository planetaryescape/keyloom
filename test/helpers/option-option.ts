// BK's Option–Option layout (D-019): Option exists only as the hold half of S on the base layer.
import { openApp, importLayout, getLayout } from "../../src/app/index.ts";
import { bindingFunctions } from "../../src/layout/functions.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { FIXTURE_DIR } from "./board.ts";
import { tempDir } from "./tmp.ts";

export const S_POSITION = 30;

/** The fixture layout with every other source of Option removed, so S is the only one. */
export function optionOnlyOnS(doc: Layout): Layout {
  return {
    ...doc,
    layers: doc.layers.map((layer) => ({
      ...layer,
      bindings: layer.bindings.map((b, position) => {
        const hasAlt = bindingFunctions(b, doc.tapDances).includes("mod:LALT") || (b.kind === "key" && b.mods?.includes("LALT")) || (b.kind === "holdTap" && "mods" in b.hold && b.hold.mods.includes("LALT"));
        return hasAlt && !(layer.id === "layer-0" && position === S_POSITION) ? ({ kind: "none" } as const) : b;
      }),
    })),
  };
}

export async function optionOptionApp() {
  const dir = tempDir();
  const app = openApp({ dataDir: dir });
  const imported = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "fixture" });
  const doc = optionOnlyOnS(getLayout(app, imported.layoutId).document);
  const created = createLayout(app.db, { name: "bk", layout: doc, summary: "Option only on S", origin: "import" });
  return { app, dir, layoutId: created.layout.id };
}
