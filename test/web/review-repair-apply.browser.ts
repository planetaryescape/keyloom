// Proves the scoped finding reaches a validated proposal, a read-only preview and explicit Apply.
import { mkdirSync } from "node:fs";
export {};

const evidence = process.argv[2];
if (!evidence) throw new Error("Pass the coordinator-assigned evidence directory");
mkdirSync(evidence, { recursive: true });
const session = Bun.spawnSync(["agent-browser", "session", "id", "--scope", "worktree", "--prefix", `keyloom-repair-apply-${process.pid}`]).stdout.toString().trim();
function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`agent-browser ${args.join(" ")} failed: ${result.stdout.toString()}${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}
const evaluate = (code: string) => browser("eval", code);
const click = (name: string) => browser("find", "role", "button", "click", "--name", name, "--exact");
try {
  browser("set", "viewport", "1440", "900");
  browser("open", "http://127.0.0.1:4531/?t=review-repair-synthetic-token");
  browser("wait", 'button[aria-label="Open Moonlander"]');
  evaluate('document.querySelector("button[aria-label=\\"Open Moonlander\\"]").click()');
  browser("wait", "--fn", "document.querySelector('.br-marker')?.textContent.includes('1 hint')===true");
  browser("screenshot", `${evidence}/1440-light-selected-finding.png`);
  evaluate('document.querySelector(".br-marker").click()');
  browser("wait", ".br-panel");
  browser("wait", "--fn", "[...document.querySelectorAll('.br-panel button')].some(b=>b.textContent.trim()==='Plan a repair'&&!b.disabled)");
  evaluate('[...document.querySelectorAll(".br-panel button")].find(b=>b.textContent.trim()==="Plan a repair").click()');
  browser("wait", ".topbar-ask");
  evaluate("if(document.querySelector('.topbar-ask')?.getAttribute('aria-pressed')==='false') document.querySelector('.topbar-ask').click()");
  browser("wait", ".repair-request");
  const original = JSON.parse(evaluate(`(()=>({target:[...document.querySelectorAll('.cap')].find(k=>k.getAttribute('aria-label')?.startsWith('Key 34.'))?.getAttribute('aria-label'),neighbor:[...document.querySelectorAll('.cap')].find(k=>k.getAttribute('aria-label')?.startsWith('Key 37.'))?.getAttribute('aria-label')}))()`));
  browser("screenshot", `${evidence}/1440-light-request-final.png`);
  click("Send request");
  browser("wait", ".proposal");
  if (!evaluate("document.querySelector('.proposal h3')?.textContent") .includes("Put F17 on the empty key")) throw new Error("fake provider did not return the scoped F17 proposal");
  browser("screenshot", `${evidence}/1440-light-proposal.png`);
  const before = JSON.parse(evaluate(`(()=>({target:[...document.querySelectorAll('.cap')].find(k=>k.getAttribute('aria-label')?.startsWith('Key 34.'))?.getAttribute('aria-label'),neighbor:[...document.querySelectorAll('.cap')].find(k=>k.getAttribute('aria-label')?.startsWith('Key 37.'))?.getAttribute('aria-label'),undo:document.querySelector('button[aria-label="Undo"]')?.disabled}))()`));
  click("Details");
  browser("wait", "--fn", "[...document.querySelectorAll('.cap')].find(k=>k.getAttribute('aria-label')?.startsWith('Key 34.'))?.getAttribute('aria-label').includes('F17')===true");
  browser("screenshot", `${evidence}/1440-light-preview.png`);
  const preview = JSON.parse(evaluate(`(()=>({target:[...document.querySelectorAll('.cap')].find(k=>k.getAttribute('aria-label')?.startsWith('Key 34.'))?.getAttribute('aria-label'),neighbor:[...document.querySelectorAll('.cap')].find(k=>k.getAttribute('aria-label')?.startsWith('Key 37.'))?.getAttribute('aria-label'),undo:document.querySelector('button[aria-label="Undo"]')?.disabled}))()`));
  if (original.target.includes("F17") || before.undo !== true || preview.undo !== true || before.neighbor !== preview.neighbor || !preview.target.includes("F17")) throw new Error("proposal preview mutated the head or changed the F18 neighbor");
  click("Apply");
  browser("wait", ".topbar-ask");
  evaluate("if(document.querySelector('.topbar-ask')?.getAttribute('aria-pressed')==='false') document.querySelector('.topbar-ask').click()");
  browser("wait", "[data-status=applied]");
  const applied = JSON.parse(evaluate(`(()=>({target:[...document.querySelectorAll('.cap')].find(k=>k.getAttribute('aria-label')?.startsWith('Key 34.'))?.getAttribute('aria-label'),neighbor:[...document.querySelectorAll('.cap')].find(k=>k.getAttribute('aria-label')?.startsWith('Key 37.'))?.getAttribute('aria-label'),applied:document.querySelector('[data-status=applied]')?.textContent}))()`));
  if (!applied.target?.includes("F17") || applied.neighbor !== before.neighbor || !applied.applied?.includes("Applied")) throw new Error("Apply did not change only the selected blank key to F17");
  browser("screenshot", `${evidence}/1440-light-applied.png`);
  click("Fresh review needed");
  browser("wait", ".br-panel");
  click("Run a fresh review");
  const fresh = await evaluate(`fetch('/api/layouts/Scoped%20repair%20journey/review',{headers:{'x-keyloom-token':new URLSearchParams(location.search).get('t')}}).then(r=>r.json()).then(x=>JSON.stringify({headRevisionId:x.headRevisionId,review:x.review}))`);
  const result = JSON.parse(JSON.parse(fresh));
  const fixedSelected = JSON.stringify(result.review?.fixed ?? []).includes('"id":"check:keys_do_nothing::layer-0/33"');
  const stillListed = (result.review?.items ?? []).some((item: { id: string }) => item.id === "check:keys_do_nothing::layer-0/33");
  if (result.review?.freshness?.current !== true || !fixedSelected || stillListed) throw new Error(`selected source finding was not resolved in the current review: ${fresh}`);
  await Bun.write(`${evidence}/selected-finding-resolution.json`, JSON.stringify({ result: "PASS", headRevisionId: result.headRevisionId, sourceFindingId: "check:keys_do_nothing::layer-0/33", fixed: result.review.fixed, remainingItemIds: result.review.items.map((item: { id: string }) => item.id) }, null, 2));
  console.log(JSON.stringify({ result: "PASS", before, preview, applied, freshReview: "one remaining unused key; selected finding resolved" }));
} catch (error) {
  console.error(String(error));
  console.error(browser("snapshot", "-i"));
  console.error(evaluate("document.body.innerText.slice(-1200)"));
  throw error;
} finally {
  browser("close");
}
