// A view that renders but whose acknowledgement is lost is saved as unavailable, and the client never retries it
// (docs/issues/open-view-unavailable-is-not-proof-of-no-render.md). Start the fixture first:
// bun test/web/open-view-server.ts 0 <new-scratch-directory>
// bun test/web/open-view-lost-ack.browser.ts <fixture-url>
export {};

const url = process.argv[2];
if (!url) throw new Error("Pass the URL open-view-server.ts printed");
const session = Bun.spawnSync(["agent-browser", "session", "id", "--scope", "worktree", "--prefix", "open-view-lost-ack"]).stdout.toString().trim();
function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")} failed: ${result.stdout}${result.stderr}`);
  return result.stdout.toString();
}
const check = (expression: string, message: string) => browser("eval", `if(!(${expression}))throw Error(${JSON.stringify(message)})`);
const settled = () => browser("wait", "--fn", "document.getAnimations().every(a=>a.playState!=='running')");
const openChat = () => browser("eval", "if(document.querySelector('.topbar-ask')?.getAttribute('aria-pressed')==='false')document.querySelector('.topbar-ask').click()");

try {
  browser("set", "viewport", "1440", "900");
  browser("set", "media", "light", "reduced-motion");
  browser("open", url);
  browser("wait", "--load", "networkidle");
  browser("wait", 'button[aria-label="Open Moonlander"]');
  settled();
  browser("eval", `document.querySelector('button[aria-label="Open Moonlander"]').click()`);
  browser("wait", ".topbar-ask");
  browser("wait", "--load", "networkidle");

  // Every acknowledgement fails in transit, after the view has rendered.
  browser("network", "route", "**/view-ack", "--abort");
  browser("network", "requests", "--clear");
  openChat();
  browser("wait", 'textarea[aria-label="Message to keyloom"]');
  browser("fill", 'textarea[aria-label="Message to keyloom"]', "Open History");
  // In the bar, Enter on a highlighted local command would open History without the agent; the panel offers no commands.
  check("![...document.querySelectorAll('.bar-command-label')].some(l=>l.textContent.trim()!=='Ask keyloom')", "A local command is offered; Enter would bypass the agent");
  browser("focus", 'textarea[aria-label="Message to keyloom"]');
  browser("press", "Enter");

  browser("wait", 'section.history-panel[aria-label="History"]');
  // The server's five-second wait for the acknowledgement expires; the run then finishes with the saved result.
  browser("wait", "--fn", "!document.querySelector('.chat[data-streaming=\"true\"]')", "--timeout", "15000");
  check(`!!document.querySelector('section.history-panel[aria-label="History"]')`, "History should still be on screen: it rendered before the acknowledgement was lost");
  const acks = browser("network", "requests", "--filter", "view-ack", "--method", "POST");
  const sent = acks.split("\n").filter((line) => line.includes("view-ack")).length;
  if (sent !== 1) throw new Error(`Expected exactly one acknowledgement attempt and no retry, saw ${sent}:\n${acks}`);

  openChat();
  browser("wait", "--fn", "document.querySelector('.chat')?.innerText.includes('Could not open history: timeout')", "--timeout", "15000");
  check("!document.querySelector('.chat').innerText.includes('history opened')", "A lost acknowledgement must not be reported as opened");
  console.log("PASS rendered History with a lost acknowledgement: saved as unavailable (timeout), not retried, not reported as opened");
} finally {
  try { browser("network", "unroute"); } catch { /* the session may already be gone */ }
  browser("close");
}
