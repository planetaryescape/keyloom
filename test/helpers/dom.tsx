// A document for tests that drive real components: mount, type and press, then read what the person would see. react-dom decides when it
// loads whether a DOM exists, and without one it never wires the input events a typed field needs, so `setUpDom` loads it after the
// document. fetch is a fake that answers the reads shared buttons make on mount (Restart keyloom's restart info, the log's place) and a
// test's own reads (`answerReads`), so nothing reaches a server.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach } from "bun:test";
import type { ReactNode } from "react";

let reads: Record<string, unknown> = {};
/** Answers for GET paths a test's components read, on top of the shared ones. Cleared after each test. */
export const answerReads = (extra: Record<string, unknown>): void => { reads = extra; };

const fakeFetch = (async (input: RequestInfo | URL) => {
  const path = new URL(String(input), "http://127.0.0.1/").pathname;
  const body = path === "/api/restart" ? { canRestart: true, command: "keyloom serve" } : path === "/api/log" ? { kind: "terminal" } : reads[path];
  if (body === undefined) return new Response(JSON.stringify({ error: { code: "not_found", message: `no fake for ${path}` } }), { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

type Act = (callback: () => unknown) => Promise<void>;
let act: Act = async () => { throw new Error("call setUpDom() first"); };
let createRoot: typeof import("react-dom/client").createRoot | null = null;
let unmount: (() => void) | null = null;

/**
 * Gives this test file a document, until its last test ends. Call it at the top of the file, with `await`, before anything renders. Each
 * file sets up its own, because bun runs every file in one process and the file before may have taken its document down.
 */
export async function setUpDom(): Promise<void> {
  const realFetch = globalThis.fetch;
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://127.0.0.1/" });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.fetch = fakeFetch;
  // Loaded once a document exists: react-dom/client reads it when it loads.
  ({ createRoot } = await import("react-dom/client"));
  act = (await import("react")).act as Act;
  afterEach(() => {
    unmount?.();
    unmount = null;
    document.body.innerHTML = "";
    reads = {};
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
    globalThis.fetch = realFetch;
  });
}

/** Renders `node` into a fresh host. The returned `render` replaces it in the same root, as a parent's re-render would. */
export async function mount(node: ReactNode): Promise<{ render: (next: ReactNode) => Promise<void> }> {
  const host = document.createElement("div");
  document.body.append(host);
  if (createRoot === null) throw new Error("call setUpDom() first");
  const root = createRoot(host);
  await act(async () => root.render(node));
  unmount = () => act(() => root.unmount());
  return { render: (next) => act(async () => root.render(next)) };
}

export { act };

export const button = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

/**
 * Types into a React-controlled field. React watches the element's own `value`, so the value is set through the class's setter, found up
 * the prototype chain (happy-dom's window classes extend the ones that define it), then the input event tells React.
 */
export async function type(selector: string, text: string): Promise<void> {
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

/** Presses the button with this text, and lets a request it starts settle. */
export async function press(label: string): Promise<void> {
  const target = button(label);
  if (target === undefined) throw new Error(`no ${label} button`);
  await act(async () => {
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
