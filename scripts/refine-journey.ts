// Drives the refine loop (D-452) through the real app in headless Chrome and screenshots each step, so the cards can be checked at the
// comp widths without a model or a keyboard:
//
//   bun scripts/refine-journey.ts [outDir]     # default docs/research/refine-loop
//
// For each theme and width it starts scripts/dev-command-shift.ts on a scratch data directory (scripted model, no build or flash routes),
// asks for one Command–Shift key, answers both questions, and shoots: after-first (one proposal, question 1 of 2), after-revised (the old
// card superseded, question 2 of 2), after-final, and after-quick (a request with nothing to ask). A run applies the final
// proposal and records the decision it wrote, from the scratch database, in journey-transcript.md; one applies the proposal question 1
// refines (after-skipped); one applies a proposal that question 2 does not refine (after-closed). Chrome gets its own profile and debugging port; it never touches
// another browser, a running keyloom, or a real data directory.
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANSWER_1, ANSWER_2, CLOSE_FOLLOWUP, QUICK_REQUEST, REQUEST } from "../test/helpers/refine-journey.ts";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.argv[2] ?? join(import.meta.dir, "..", "docs", "research", "refine-loop");
const APP_PORT = 4493;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "refine-journey-chrome-"));
// Port 0 lets Chrome pick a free debugging port and write it to its own profile, so the script can only reach the Chrome it started,
// never another browser already listening on a fixed port.
const chrome = Bun.spawn([CHROME, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdout: "ignore", stderr: "ignore" });
// The profile and every run's data directory live in $TMPDIR and nothing else would remove them. An exit handler covers a failed run and
// Ctrl-C (which exits through it) as well as the normal end; Chrome is stopped first so it stops writing into its profile.
const scratch: string[] = [profile];
let demoServer: Bun.Subprocess | undefined;
const removeScratch = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
process.once("exit", () => {
  chrome.kill("SIGKILL");
  demoServer?.kill("SIGKILL");
  for (const dir of scratch) removeScratch(dir);
});
process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));
let targets: Array<{ type: string; webSocketDebuggerUrl: string }> = [];
for (let i = 0; i < 50 && targets.length === 0; i++) {
  await sleep(200);
  try {
    const port = (await Bun.file(join(profile, "DevToolsActivePort")).text()).split("\n")[0];
    targets = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as typeof targets).filter((t) => t.type === "page");
  } catch { /* not up yet */ }
}
const ws = new WebSocket(targets[0]?.webSocketDebuggerUrl ?? "");
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
const waiters: Array<{ method: string; resolve: () => void }> = [];
ws.onmessage = (m) => {
  const d = JSON.parse(String(m.data));
  if (d.id && pending.has(d.id)) { pending.get(d.id)?.(d.result); pending.delete(d.id); }
  if (d.method) for (const w of waiters.filter((x) => x.method === d.method)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(); }
};
const send = (method: string, params: object = {}) => new Promise<any>((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
const once = (method: string) => new Promise<void>((resolve) => waiters.push({ method, resolve }));
const js = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
await send("Page.enable");

async function until(what: string, expression: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(expression)) return;
    await sleep(150);
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, "journey-failed.png"), Buffer.from(shot.data, "base64"));
  throw new Error(`timed out waiting for ${what}. The page said: ${String(await js("document.body.innerText")).slice(0, 1500)}`);
}
const clickText = (text: string) => js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
async function say(text: string) {
  await js("document.querySelector('textarea[aria-label=\"Message to keyloom\"]').focus()");
  await send("Input.insertText", { text });
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
}
const idle = "!document.querySelector('.chat')?.dataset.streaming || document.querySelector('.chat').dataset.streaming === 'false'";
const chatText = () => js("document.querySelector('.chat')?.innerText ?? ''") as Promise<string>;

async function shoot(name: string, theme: string, width: number) {
  await sleep(500);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}-${theme}-${width}.png`), Buffer.from(shot.data, "base64"));
}

const transcript: string[] = [];

/** One fresh server and page: ask for the key, answer both questions, and (when `apply`) apply the final proposal and read the decision. */
async function journey(theme: string, width: number, height: number, record: boolean, apply: boolean, skip = false, close = false) {
  const dataDir = mkdtempSync(join(tmpdir(), "keyloom-refine-"));
  scratch.push(dataDir);
  const server = Bun.spawn(["bun", join(import.meta.dir, "dev-command-shift.ts"), String(APP_PORT), dataDir, ...(close ? ["close"] : [])], { stdout: "pipe", stderr: "inherit" });
  demoServer = server;
  const reader = server.stdout.getReader();
  const started = new TextDecoder().decode((await reader.read()).value);
  if (!started.includes(String(APP_PORT))) throw new Error(`the demo server did not start: ${started}`);
  const open = async () => {
    const loaded = once("Page.loadEventFired");
    await send("Page.navigate", { url: `http://127.0.0.1:${APP_PORT}/?t=dev-token` });
    await loaded;
    await until("the board", "document.body.innerText.includes('Layer 0')");
    await js("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ask keyloom'))?.click()");
    await until("the message box", "!!document.querySelector('textarea[aria-label=\"Message to keyloom\"]')");
  };
  try {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await open();

    if (close) {
      // A proposal, then a question that refines none of the proposals. Applying the proposal closes the question.
      await say(QUICK_REQUEST);
      await until("the proposal", "document.body.innerText.includes('F16 is now Command')", 30_000);
      await until("the reply to end", idle);
      await say(CLOSE_FOLLOWUP);
      await until("the question", "document.body.innerText.includes('Backspace was placed on purpose')", 30_000);
      await until("the reply to end", idle);
      await clickText("Apply");
      await sleep(1000);
      await js("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ask keyloom'))?.click()");
      await until("Closed", "document.body.innerText.includes('Closed, you applied another proposal')", 20_000);
      await shoot("after-closed", theme, width);
      transcript.push(`## Applying a proposal that the open question does not refine\n${await chatText()}`);
      return;
    }
    await say(REQUEST);
    await until("question 1 of 2", "/question 1 of 2/i.test(document.body.innerText)", 30_000);
    await until("the reply to end", idle);
    if (!apply && !skip) await shoot("after-first", theme, width);
    if (record) transcript.push(`## After the request\n${await chatText()}`);
    if (skip) {
      // Applying the proposal question 1 refines closes the question as skipped.
      await clickText("Apply");
      // The bar closes after an apply; the thread is there when it is opened again.
      await sleep(1000);
      await js("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ask keyloom'))?.click()");
      await until("Skipped", "document.body.innerText.includes('Skipped, you applied the proposal')", 20_000);
      await shoot("after-skipped", theme, width);
      transcript.push(`## Applying while question 1 is open\n${await chatText()}`);
      return;
    }

    await clickText("No, keep them where they are");
    await until("question 2 of 2", "/question 2 of 2/i.test(document.body.innerText)", 30_000);
    await until("the reply to end", idle);
    if (!apply) await shoot("after-revised", theme, width);
    if (!apply) {
      // The card the revision replaced is above the fold in a long thread; bring it into view.
      await js("(() => { const log = document.querySelector('.chat-log'); const card = document.querySelector('.proposal-superseded'); if (log && card) log.scrollTop += card.getBoundingClientRect().top - log.getBoundingClientRect().top - 8; })()");
      await shoot("after-revised-superseded", theme, width);
      await js("document.querySelector('.chat-log').scrollTop = document.querySelector('.chat-log').scrollHeight");
    }
    if (record) transcript.push(`## After answer 1 (${ANSWER_1})\n${await chatText()}`);

    await clickText("Yes, F16");
    await until("the final proposal", "document.body.innerText.includes('Command–Shift is on the F16 key')", 30_000);
    await until("the reply to end", idle);
    if (!apply) await shoot("after-final", theme, width);
    if (record) transcript.push(`## After answer 2 (${ANSWER_2})\n${await chatText()}`);

    if (apply) {
      // Apply the final proposal, then read what it wrote from the scratch database.
      await clickText("Apply");
      await until("Applied", "document.body.innerText.includes('Applied')", 20_000);
      const db = new Database(join(dataDir, "keyloom.db"), { readonly: true });
      const rows = db.query("SELECT status, goal, choice, reason, source_message_ids FROM decisions WHERE kind = 'choice'").all();
      const sets = db.query("SELECT title, status, tradeoffs FROM change_sets ORDER BY created_at").all();
      db.close();
      transcript.push(`## The decision applying wrote\n${JSON.stringify(rows, null, 2)}\n\n## The change sets (status; the revision chain is in tradeoffs.supersedes)\n${JSON.stringify(sets, null, 2)}`);
    } else {
      // A new conversation (the bar's More menu): a request with nothing to ask. A reload would reopen this thread, where the earlier
      // proposal is still open and a proposal would have to declare supersedes.
      await js("document.querySelector('.chat .bar-more')?.click()");
      await sleep(300);
      await clickText("New conversation");
      await sleep(400);
      await say(QUICK_REQUEST);
      await until("the quick proposal", "document.querySelectorAll('.proposal-group').length === 1 && document.body.innerText.includes('Drops F16') && document.body.innerText.includes('F16 is now Command')", 30_000);
      await until("the reply to end", idle);
      if (process.env.JOURNEY_DEBUG) console.log(await js("JSON.stringify([...document.querySelectorAll('.proposal-group')].map((g) => [g.className, g.innerText.slice(0, 60), JSON.stringify(g.getBoundingClientRect())]))"));
      await shoot("after-quick", theme, width);
      if (record) transcript.push(`## A request with nothing to ask\n${await chatText()}`);
    }
  } finally {
    server.kill("SIGTERM");
    await server.exited;
    removeScratch(dataDir);
    scratch.splice(scratch.indexOf(dataDir), 1);
  }
}

// JOURNEY_ONLY="light:390" runs one combination and skips the apply and skip runs, for a quick look.
const only = process.env.JOURNEY_ONLY;
for (const theme of ["light", "dark"]) for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  if (only !== undefined && only !== `${theme}:${width}`) continue;
  await journey(theme, width, height, theme === "light" && width === 1440, false);
}
if (only === undefined) {
  await journey("light", 1440, 900, true, true);
  await journey("light", 1440, 900, false, false, true);
  await journey("light", 1440, 900, false, false, false, true);
}
writeFileSync(join(OUT, "journey-transcript.md"), `# The refine journey through the real app\n\nScripted model, scratch data directory, headless Chrome 1440x900, light theme. Text is the chat column's innerText after each step.\n\n${transcript.join("\n\n")}\n`);
ws.close();
chrome.kill("SIGTERM");
await sleep(500);
console.log("done");
