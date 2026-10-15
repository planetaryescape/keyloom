// Reads one ZMK binding typed by a person (`&mt LCTRL A`, `&mo 1`) with the importer's own mapping,
// so the editor's "Any" field and a Layout Editor import agree on what a binding means.
import { type BehaviorCall, parseCalls } from "./cells.ts";
import { type MapContext, type Mapped, mapBinding } from "./bindings.ts";

export type Parsed = { ok: true; mapped: Mapped } | { ok: false; message: string };

/** Exactly one behaviour call; the leading `&` is optional because it is easy to leave off. */
export function parseZmkExpression(text: string, ctx: MapContext): Parsed {
  const source = text.trim();
  if (source === "") return { ok: false, message: "Type a ZMK binding, such as &mt LCTRL A or &mo 1." };
  const { calls, leading }: { calls: BehaviorCall[]; leading: string[] } = parseCalls(source.startsWith("&") ? source : `&${source}`);
  const [call] = calls;
  if (call === undefined || calls.length !== 1 || leading.length > 0) {
    return { ok: false, message: `"${source}" isn't one ZMK binding. Write a behaviour and its parameters, like &kp A.` };
  }
  return { ok: true, mapped: mapBinding(call, ctx) };
}
