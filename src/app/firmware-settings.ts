// What the Settings page shows for a layout (D-103, D-191), as data the CLI prints too (D-030, D-459): each firmware option with the
// value the firmware gets, the baseline, whether the layout stores it and why it is forced. Read only; a change goes through ops.
import { type OptionSpec, baselineOf, currentValue, forcedOn, isSet, optionsFor, sourceText } from "../layout/firmware-options.ts";
import { getLayout } from "./layouts.ts";
import type { App } from "./context.ts";

export type SettingView = {
  key: string;
  name: string;
  group: OptionSpec["group"];
  kind: OptionSpec["kind"];
  /** "ms" and so on; empty for a flag or a count. */
  unit: string;
  /** What the firmware gets now, forced values included. */
  value: number | boolean;
  /** What the firmware does with no setting from keyloom. */
  default: number | boolean;
  /** The layout writes this option itself. */
  stored: boolean;
  /** The stored text when it is an expression the model can't read as a number or switch, such as `(TAPPING_TERM + 10)`. */
  sourceText: string | null;
  /** Why the value is forced, or null. */
  forcedBy: string | null;
  /** What a 0 means, when it isn't "0 ms". */
  zero: string | null;
};

export type SettingsView = { layoutId: string; name: string; boardId: string; revisionId: string; firmware: string; settings: SettingView[] };

export function layoutSettings(app: App, ref: string, revisionId?: string): SettingsView {
  const view = getLayout(app, ref, revisionId);
  const board = view.board.definition;
  const settings = optionsFor(board).map((spec): SettingView => ({
    key: spec.key,
    name: spec.label,
    group: spec.group,
    kind: spec.kind,
    unit: spec.kind === "number" ? spec.unit : "",
    value: currentValue(spec, view.document, board),
    default: baselineOf(spec, view.document, board),
    stored: isSet(spec, view.document),
    sourceText: sourceText(spec, view.document) ?? null,
    forcedBy: forcedOn(spec, view.document),
    zero: spec.kind === "number" ? spec.zero ?? null : null,
  }));
  return { layoutId: view.layout.id, name: view.layout.name, boardId: view.layout.boardId, revisionId: view.revision.id, firmware: board.firmware, settings };
}
