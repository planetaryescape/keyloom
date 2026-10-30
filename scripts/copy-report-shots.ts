// Shoots the copy's report card (D-467) in the new config's conversation, at 1440x900 and 390x844, light and dark, through
// scripts/dev-copy-layout.ts: a scripted model, a scratch data directory, no build or flash routes. It also checks that the drops
// disclosure opens from the keyboard, that no banned wording renders, and that nothing overflows at phone width.
//
//   bun scripts/copy-report-shots.ts [outDir]     # default docs/research/ui-audit/b-copy-transfer
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const OUT = process.argv[2] ?? join(REPO, "docs", "research", "ui-audit", "b-copy-transfer");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 4495;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "b-shots-chrome-"));
const scratch = [profile];
const removeScratch = (dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
async function stop(child: Bun.Subprocess | undefined) {
  if (child === undefined || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const stuck = await Promise.race([child.exited.then(() => false), sleep(5000).then(() => true)]);
  if (stuck) {
    child.kill("SIGKILL");
    await child.exited;
  }
}
const chrome = Bun.spawn([CHROME, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdout: "ignore", stderr: "ignore" });
let server: Bun.Subprocess | undefined;
async function cleanup() {
  await Promise.all([stop(chrome), stop(server)]);
  for (const dir of scratch.splice(0)) removeScratch(dir);
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => void cleanup().finally(() => process.exit(code)));
}

let targets: Array<{ type: string; webSocketDebuggerUrl: string }> = [];
for (let i = 0; i < 50 && targets.length === 0; i++) {
  await sleep(200);
  try {
    const port = (await Bun.file(join(profile, "DevToolsActivePort")).text()).split("\n")[0];
    // SAFETY: /json/list is Chrome's own DevTools target list.
    targets = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as typeof targets).filter((t) => t.type === "page");
  } catch { /* not up yet */ }
}
if (targets[0] === undefined) {
  await cleanup();
  throw new Error("Chrome did not open a page to drive");
}
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
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
await send("Runtime.enable");

async function until(what: string, expression: string, ms = 45_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(expression)) return;
    await sleep(150);
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, "failed.png"), Buffer.from(shot.data, "base64"));
  throw new Error(`timed out waiting for ${what}. The page said: ${String(await js("document.body.innerText")).slice(0, 1500)}`);
}
async function shoot(name: string) {
  await sleep(600);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
}
const press = (key: string, code: string, vk: number, text?: string) =>
  send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, ...(text === undefined ? {} : { text, unmodifiedText: text }) })
    .then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk }));

const findings: string[] = [];
let cardText = "";
try {
  for (const theme of ["light", "dark"]) for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    // Each capture gets its own server and data directory: the second copy of the same name would rightly be refused.
    const dataDir = mkdtempSync(join(tmpdir(), "b-shots-data-"));
    scratch.push(dataDir);
    const started_ = Bun.spawn(["bun", join(REPO, "scripts", "dev-copy-layout.ts"), String(PORT), dataDir], { cwd: REPO, stdout: "pipe", stderr: "inherit" });
    server = started_;
    if (started_.stdout === undefined) throw new Error("the demo server printed nothing");
    const started = new TextDecoder().decode((await started_.stdout.getReader().read()).value);
    if (!started.includes(String(PORT))) throw new Error(`the demo server did not start: ${started}`);
    try {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: width < 600 });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      const loaded = once("Page.loadEventFired");
      await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/?t=dev-token` });
      await loaded;
      await until("the board", "document.body.innerText.includes('Layer 0')");
      await js("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ask keyloom'))?.click()");
      await until("the message box", "!!document.querySelector('textarea[aria-label=\"Message to keyloom\"]')");
      await js("document.querySelector('textarea[aria-label=\"Message to keyloom\"]').focus()");
      await send("Input.insertText", { text: "Copy my Moonlander setup onto my Corne" });
      await press("Enter", "Enter", 13, "\r");
      // The app carries the reader into the new config's conversation; the card is on its first reply.
      await until("the copy's card", "!!document.querySelector('.transfer-card')", 60_000);
      await until("the reply to end", "!document.querySelector('.chat')?.dataset.streaming || document.querySelector('.chat').dataset.streaming === 'false'");
      await until("the new config", "document.body.innerText.includes('on Corne')");
      // The carry reloads into the new config; its thread is fetched again, so wait for the card to be back before framing it.
      await until("the card in the new config", "!!document.querySelector('.transfer-card')", 30_000);
      // Bring the card's top into view in the thread, as a reader would scroll to it.
      // Frame the card's top inside whatever scrolls the thread: the page's chat column, or the phone's bottom sheet.
      const frame = `(() => { const card = document.querySelector('.transfer-card'); let node = card?.parentElement; while (node && node.scrollHeight <= node.clientHeight + 1) node = node.parentElement; const cardRect = card?.getBoundingClientRect(), nodeRect = node?.getBoundingClientRect(); if (node && cardRect && nodeRect) node.scrollTop += cardRect.top - nodeRect.top - 8; })()`;
      await js(frame);
      await sleep(300);
      await sleep(300);
      await shoot(`card-${theme}-${width}x${height}`);

      const facts = await js(`(() => {
        const card = document.querySelector('.transfer-card');
        const details = card?.querySelector('details.transfer-drops');
        const root = document.documentElement;
        const rect = card?.getBoundingClientRect();
        return {
          text: (card?.innerText ?? '').slice(0, 4000),
          summary: details?.querySelector('summary')?.innerText ?? null,
          open: details?.open ?? false,
          overflow: root.scrollWidth > root.clientWidth,
          startsInView: rect ? rect.top >= 0 && rect.top < innerHeight : false,
          cardWidth: Math.round(rect?.width ?? 0),
          cardHeight: Math.round(rect?.height ?? 0),
          viewport: innerWidth,
          failed: document.body.innerText.includes('Failed'),
          banned: /unsupported|successfully|!/i.test(card?.innerText ?? ''),
        };
      })()`);
      findings.push(`${theme} ${width}x${height}: card ${facts.cardWidth}x${facts.cardHeight}px in ${facts.viewport}x${height}px, starts in view=${facts.startsInView}, overflow=${facts.overflow}, failed step=${facts.failed}, banned wording=${facts.banned}, summary=${JSON.stringify(facts.summary)}`);
      if (facts.overflow) throw new Error(`the card overflows at ${width}x${height} (${theme})`);
      if (facts.banned) throw new Error(`the card reads with banned wording at ${width}x${height} (${theme})`);
      if (facts.failed) throw new Error(`a step failed before the card at ${width}x${height} (${theme})`);
      if (!facts.startsInView) throw new Error(`the card did not scroll into view at ${width}x${height} (${theme})`);
      if (facts.summary === null) throw new Error(`no drops disclosure at ${width}x${height} (${theme})`);
      if (theme === "dark" && width === 1440) cardText = facts.text;
      // The phone's sheet is shorter than the card at that width: two more shots scroll through it, as a reader would.
      if (width < 600) {
        await js("(() => { const log = document.querySelector('.chat-log'); if (log) log.scrollTop += Math.round(log.clientHeight * 0.75); })()");
        await shoot(`card-mid-${theme}-${width}x${height}`);
        await js("(() => { const log = document.querySelector('.chat-log'); if (log) log.scrollTop = log.scrollHeight; })()");
        await shoot(`card-end-${theme}-${width}x${height}`);
      }

      if (theme === "dark" && width === 1440) {
        // The disclosure opens from the keyboard: focus the summary and press Enter.
        await js("document.querySelector('.transfer-drops summary')?.focus()");
        await press("Enter", "Enter", 13, "\r");
        await sleep(400);
        const open = await js("document.querySelector('.transfer-drops')?.open === true && document.querySelector('.transfer-drops summary') === document.activeElement");
        findings.push(`keyboard: summary focused, Enter opened the details and kept focus = ${open}`);
        if (!open) throw new Error("the drops disclosure did not open from the keyboard");
        await js(`(() => { const card = document.querySelector('.transfer-card'); const log = document.querySelector('.chat-log'); if (card && log) log.scrollTop += card.getBoundingClientRect().top - log.getBoundingClientRect().top - 16; })()`);
        await shoot("card-open-dark-1440x900");
      }
    } finally {
      await stop(server);
      server = undefined;
      removeScratch(dataDir);
      scratch.splice(scratch.indexOf(dataDir), 1);
    }
  }
  writeFileSync(join(OUT, "card-text.txt"), `${cardText}\n`);
  writeFileSync(join(OUT, "capture-notes.txt"), `${findings.join("\n")}\n`);
} finally {
  ws.close();
  await cleanup();
}
console.log(findings.join("\n"));
console.log("done");
