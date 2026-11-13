// R10-05 and R10-07: the config dialogs' and Restore {board}'s turned-off state, driven through the real components. A confirm that keyloom answers with its catch-all
// `not_found` or an unreadable answer would fail the same way if pressed again, so it goes off and Restart keyloom is the primary button.
// An exception can pass on a second try, so its confirm stays and stays primary. happy-dom gives React a document; fetch is a fake that
// answers only the restart info, the log's place and the versions list, so nothing reaches a server.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";

// Registered before React loads, not in beforeAll: react-dom decides at load whether a DOM exists, and without one it never wires the input
// events a typed name needs.
const realFetch = globalThis.fetch;
GlobalRegistrator.register({ url: "http://127.0.0.1/" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const path = new URL(String(input), "http://127.0.0.1/").pathname;
  const body = path === "/api/restart" ? { canRestart: true, command: "keyloom serve" }
    : path === "/api/log" ? { kind: "terminal" }
    : { layoutId: "cfg_1", layoutName: "Base", headRevisionId: "rev_1", pending: [], versions: [] };
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

afterAll(async () => {
  await GlobalRegistrator.unregister();
  globalThis.fetch = realFetch;
});

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ApiError } = await import("../../src/web/api.ts");
const { ConfirmDialog, DeleteConfigDialog, NewConfigDialog, RenameDialog } = await import("../../src/web/configs/ConfigDialogs.tsx");
const { RestoreKeyboard } = await import("../../src/web/keyboards/RestoreKeyboard.tsx");
const { INTERNAL_WORDS, NOT_FOUND_WORDS, UNREADABLE_WORDS } = await import("../../src/web/shell/unexpected.ts");

const mismatch = () => new ApiError(404, NOT_FOUND_WORDS, { code: "not_found", generic: true });
const unreadable = () => new ApiError(200, UNREADABLE_WORDS, { code: "unreadable" });
const exception = () => new ApiError(500, INTERNAL_WORDS, { code: "internal" });

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
});

async function mount(node: ReactNode): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  unmount = () => act(() => root.unmount());
}

const button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

/**
 * Types into a React-controlled field. React watches the element's own `value`, so the value is set through the class's setter, found up
 * the prototype chain (happy-dom's window classes extend the ones that define it), then the input event tells React.
 */
async function type(selector: string, text: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement>(selector);
  if (field === null) throw new Error(`no ${selector}`);
  let proto: object | null = Object.getPrototypeOf(field);
  let setter: ((value: string) => void) | undefined;
  while (proto !== null && setter === undefined) {
    setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    proto = Object.getPrototypeOf(proto);
  }
  if (setter === undefined) throw new Error("no value setter");
  await act(async () => {
    setter.call(field, text);
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function press(label: string): Promise<void> {
  const target = button(label);
  if (target === undefined) throw new Error(`no ${label} button`);
  await act(async () => {
    target.click();
    // The confirm's promise rejects on a later tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

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
  const dialog = (fails: () => Error) => (
    <NewConfigDialog token="t" source={{ id: "cfg_1", name: "Base" }} boardId="zsa/moonlander" boardName="Moonlander"
      onCreate={async () => { throw fails(); }} onImport={() => {}} onClose={() => {}} />
  );

  test("a catch-all not_found turns Make off and makes Restart keyloom primary", async () => {
    await mount(dialog(mismatch));
    await type("#config-name", "Travel");
    await press("Make Travel");
    expect(after("Make Travel")).toEqual({ confirmShown: true, confirmOff: true, restartPrimary: true });
  });

  test("an exception leaves Make on", async () => {
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
