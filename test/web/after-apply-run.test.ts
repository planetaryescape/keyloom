// The after-apply line's button runs the page's own handler for each action (R3-03), and without a page only Build and flash runs.
import { expect, test } from "bun:test";
import { type AfterApplyKeyboard, afterApplyRun } from "../../src/web/release/AfterApply.tsx";

test("each action runs its handler", () => {
  const ran: string[] = [];
  const keyboard: AfterApplyKeyboard = {
    board: { firmware: "kanata", name: "MacBook" }, layoutId: "lay_1", revisionId: "rev_1", sync: undefined,
    onApplyNow: () => ran.push("apply"), onPutOn: () => ran.push("put"), onOpenStatus: () => ran.push("status"), onReplaceForeign: () => ran.push("replace"),
  };
  const release = () => ran.push("release");
  for (const id of ["apply_now", "put_on", "open_status", "replace_foreign", "open_release"] as const) afterApplyRun({ id, label: id }, keyboard, release)?.();
  expect(ran).toEqual(["apply", "put", "status", "replace", "release"]);
  expect(afterApplyRun(null, keyboard, release)).toBeNull();
  // A card outside a layout page can't open the keyboard's status or replace kanata's config, so it shows no button for them.
  expect(afterApplyRun({ id: "open_status", label: "Set up kanata" }, null, release)).toBeNull();
});
