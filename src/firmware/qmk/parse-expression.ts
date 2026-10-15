// Reads one keycode expression typed by a person (`LCTL_T(KC_A)`, `MO(1)`) with the importer's own
// mapping, so the editor's "Any" field and an Oryx import agree on what an expression means.
import { type MapContext, type Mapped, mapKey } from "./bindings.ts";
import { type Expr, toExpr, withTree } from "./c-parse.ts";

export type Parsed = { ok: true; mapped: Mapped } | { ok: false; message: string };

/**
 * `ctx.isHomeRow` decides which profile a mod-tap gets, the same rule as an import. A parse
 * error or a shape that isn't one expression is `ok: false`: unlike an import, there is no file
 * to keep as written, so garbage must not become a native binding that fails the firmware build.
 */
export async function parseQmkExpression(text: string, position: number, ctx: MapContext): Promise<Parsed> {
  const source = text.trim();
  if (source === "") return { ok: false, message: "Type a QMK keycode, such as LCTL_T(KC_A) or MO(1)." };
  const expr = await withTree(`int x = ${source};`, (root): Expr | null => {
    if (root.hasError) return null;
    const value = root.descendantsOfType("init_declarator")[0]?.childForFieldName("value");
    return value ? toExpr(value) : null;
  });
  if (expr === null || expr.kind === "other" || expr.kind === "num") {
    return { ok: false, message: `"${source}" isn't a QMK keycode keyloom can read. Check the spelling and the brackets.` };
  }
  return { ok: true, mapped: mapKey(expr, position, ctx) };
}
