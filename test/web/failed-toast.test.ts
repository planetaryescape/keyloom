// R9-05: the editor's failed-action toasts (archive, restore, undo, go back) keep the failure's code. A failure no screen planned for gets
// Restart keyloom, which opens the restart dialog with Try again only where a second try can pass.
import { expect, test } from "bun:test";
import { ApiError, UNREACHABLE } from "../../src/web/api.ts";
import { type UnexpectedDialog, failedToast } from "../../src/web/shell/failed-toast.ts";
import { INTERNAL_WORDS, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";

const opened: UnexpectedDialog[] = [];
const open = (dialog: UnexpectedDialog) => { opened.push(dialog); };
const retry = () => {};

test("an exception's toast says keyloom's words and opens the restart dialog with Try again", () => {
  opened.length = 0;
  const toast = failedToast("Couldn't archive it", new ApiError(500, INTERNAL_WORDS, { code: "internal" }), open, retry);
  expect(toast).toMatchObject({ kind: "error", message: "Couldn't archive it", detail: INTERNAL_WORDS, action: { label: "Restart keyloom" } });
  toast.action?.run();
  expect(opened[0]).toMatchObject({ title: "Couldn't archive it", failure: { code: "internal" }, retry });
});

test("an answer that fails the same way every time opens the dialog without Try again", () => {
  opened.length = 0;
  const toast = failedToast("Couldn't undo", new ApiError(400, UNREADABLE_WORDS, { code: "unreadable" }), open, retry);
  toast.action?.run();
  expect(opened).toHaveLength(1);
  expect(opened[0]?.retry).toBeUndefined();
});

test("a failure the screen planned for keeps its sentence and adds no restart", () => {
  const toast = failedToast("Couldn't restore it", new ApiError(0, UNREACHABLE), open, retry);
  expect(toast).toEqual({ kind: "error", message: "Couldn't restore it", detail: UNREACHABLE });
});
