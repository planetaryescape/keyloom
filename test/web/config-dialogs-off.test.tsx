// R10-05 and R10-07: the turned-off state of the config dialogs and of Restore {board}, driven through the real components. A confirm that
// keyloom answers with its catch-all `not_found` or an unreadable answer would fail the same way if pressed again, so it goes off and
// Restart keyloom is the primary button. An exception can pass on a second try, so its confirm stays and stays primary.
import { describe, expect, test } from "bun:test";
import { ApiError } from "../../src/web/api.ts";
import { ConfirmDialog, DeleteConfigDialog, NewConfigDialog, RenameDialog } from "../../src/web/configs/ConfigDialogs.tsx";
import { RestoreKeyboard } from "../../src/web/keyboards/RestoreKeyboard.tsx";
import { INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS } from "../../src/web/shell/unexpected.ts";
import { answerReads, button, mount, press, setUpDom, type } from "../helpers/dom.tsx";

await setUpDom();

const mismatch = () => new ApiError(404, NOT_FOUND_WORDS, { code: "not_found", generic: true });
const unreadable = () => new ApiError(200, UNREADABLE_WORDS, { code: "unreadable" });
const exception = () => new ApiError(500, INTERNAL_WORDS, { code: "internal" });

/** The way on after the failure: the confirm and Restart keyloom, as the person sees them. */
function after(confirm: string) {
  const restart = button("Restart keyloom");
  const own = button(confirm);
  return { confirmShown: own !== undefined, confirmOff: own?.disabled ?? true, restartPrimary: restart?.className.includes("button-primary") ?? null };
}

describe("ConfirmDialog", () => {
  const dialog = (fails: () => Error) => (
    <ConfirmDialog token="t" title="Put Travel on your Moonlander?" lines={["keyloom builds Travel."]} confirmLabel="Put it on"
      onConfirm={async () => { throw fails(); }} onClose={() => {}} />
  );

  test("a catch-all not_found takes Put it on away and makes Restart keyloom primary", async () => {
    await mount(dialog(mismatch));
    await press("Put it on");
    expect(document.body.textContent).toContain(NOT_FOUND_WORDS);
    expect(after("Put it on")).toEqual({ confirmShown: false, confirmOff: true, restartPrimary: true });
  });

  test("an exception keeps Put it on as the Try again, with Restart keyloom beside it", async () => {
    await mount(dialog(exception));
    await press("Put it on");
    expect(after("Put it on")).toEqual({ confirmShown: true, confirmOff: false, restartPrimary: false });
  });
});

describe("RenameDialog", () => {
  const dialog = (fails: () => Error) => <RenameDialog token="t" current="Base" onRename={async () => { throw fails(); }} onClose={() => {}} />;

  test("an unreadable answer turns Rename off and makes Restart keyloom primary", async () => {
    await mount(dialog(unreadable));
    await type("#config-rename", "Travel");
    await press("Rename");
    expect(document.body.textContent).toContain(UNREADABLE_WORDS);
    expect(after("Rename")).toEqual({ confirmShown: true, confirmOff: true, restartPrimary: true });
  });

  test("an exception leaves Rename on, and Restart keyloom second", async () => {
    await mount(dialog(exception));
    await type("#config-rename", "Travel");
    await press("Rename");
    expect(after("Rename")).toEqual({ confirmShown: true, confirmOff: false, restartPrimary: false });
  });

  test("without a token there is no Restart keyloom, so Rename stays the only way on", async () => {
    await mount(<RenameDialog current="Base" onRename={async () => { throw mismatch(); }} onClose={() => {}} />);
    await type("#config-rename", "Travel");
    await press("Rename");
    expect(after("Rename")).toEqual({ confirmShown: true, confirmOff: false, restartPrimary: null });
  });
});

describe("NewConfigDialog", () => {
  const versions = () => answerReads({ "/api/configs/cfg_1/versions": { layoutId: "cfg_1", layoutName: "Base", headRevisionId: "rev_1", pending: [], versions: [] } });
  const dialog = (fails: () => Error) => (
    <NewConfigDialog token="t" source={{ id: "cfg_1", name: "Base" }} boardId="zsa/moonlander" boardName="Moonlander"
      onCreate={async () => { throw fails(); }} onImport={() => {}} onClose={() => {}} />
  );

  test("a catch-all not_found turns Make off and makes Restart keyloom primary", async () => {
    versions();
    await mount(dialog(mismatch));
    await type("#config-name", "Travel");
    await press("Make Travel");
    expect(after("Make Travel")).toEqual({ confirmShown: true, confirmOff: true, restartPrimary: true });
  });

  test("an exception leaves Make on", async () => {
    versions();
    await mount(dialog(exception));
    await type("#config-name", "Travel");
    await press("Make Travel");
    expect(after("Make Travel")).toEqual({ confirmShown: true, confirmOff: false, restartPrimary: false });
  });
});

describe("DeleteConfigDialog", () => {
  const dialog = (fails: () => Error) => <DeleteConfigDialog token="t" name="Old" onDelete={async () => { throw fails(); }} onClose={() => {}} />;

  test("an unreadable answer turns Delete off and makes Restart keyloom primary", async () => {
    await mount(dialog(unreadable));
    await type("#config-delete", "Old");
    await press("Delete Old");
    expect(after("Delete Old")).toEqual({ confirmShown: true, confirmOff: true, restartPrimary: true });
  });

  test("an exception leaves Delete on", async () => {
    await mount(dialog(exception));
    await type("#config-delete", "Old");
    await press("Delete Old");
    expect(after("Delete Old")).toEqual({ confirmShown: true, confirmOff: false, restartPrimary: false });
  });
});

// R10-07: Restore {board} beside a config refused for a removed keyboard keeps its failure's code.
describe("RestoreKeyboard", () => {
  const restore = (fails: () => Error) => (
    <RestoreKeyboard token="t" restore={async () => { throw fails(); }} boardName="Glove80" doing="make this config" onRestored={() => {}} />
  );

  test("a restore keyloom answers unreadably turns Restore off and makes Restart keyloom primary", async () => {
    await mount(restore(unreadable));
    await press("Restore Glove80");
    expect(document.body.textContent).toContain(`keyloom couldn't restore the Glove80. ${UNREADABLE_WORDS}`);
    expect(after("Restore Glove80")).toEqual({ confirmShown: true, confirmOff: true, restartPrimary: true });
  });

  test("an exception keeps Restore as the Try again, with Restart keyloom beside it", async () => {
    await mount(restore(exception));
    await press("Restore Glove80");
    expect(after("Restore Glove80")).toEqual({ confirmShown: true, confirmOff: false, restartPrimary: false });
  });
});
