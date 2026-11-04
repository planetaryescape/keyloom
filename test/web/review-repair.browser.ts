// Terminal 1: bun test/web/review-repair-server.ts <evidence-dir>
// Terminal 2: bun test/web/review-repair.browser.ts <evidence-dir>
// Real App routes and mounted React; local deterministic fake provider only.
import { mkdirSync } from "node:fs";
export {};

const evidence = process.argv[2];
if (!evidence) throw new Error("Pass the coordinator-assigned evidence directory");
mkdirSync(evidence, { recursive: true });
const session = Bun.spawnSync(["agent-browser", "session", "id", "--scope", "worktree", "--prefix", `keyloom-review-repair-lifecycle-${process.pid}`]).stdout.toString().trim();
function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`agent-browser ${args.join(" ")} failed: ${result.stdout.toString()}${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}
const evalPage = (code: string) => browser("eval", code);
const goHome = () => {
  if (evalPage("Boolean(document.querySelector('.topbar-home-btn')?.getBoundingClientRect().height)") === "true") {
    browser("find", "role", "button", "click", "--name", "Pegboard Home");
    return;
  }
  evalPage('document.querySelector("button[aria-label=More]").click()');
  wait('[role="menuitem"]');
  browser("find", "role", "menuitem", "click", "--name", "Pegboard wall");
};
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const clickText = (text: string) => {
  browser("find", "role", "button", "click", "--name", text, "--exact");
};
const wait = (selector: string) => browser("wait", selector);

try {
  browser("set", "viewport", "390", "844");
  browser("open", "http://127.0.0.1:4531/?t=review-repair-synthetic-token");
  wait('button[aria-label*="Moonlander"]');
  evalPage('[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Open Moonlander")?.click()');
  browser("wait", "--fn", "document.querySelector('.br-marker')?.textContent.includes('1 hint')===true");

  // Count mutating agent-run POSTs from the real mounted App. A proposal-plan click must not send.
  evalPage(`(()=>{window.__repairPosts=[];window.__cancelPosts=[];window.__repairMode='normal';window.__realFetch=window.fetch.bind(window);window.fetch=async(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url,location.origin);if(u.pathname==='/api/agent/v1/runs'&&init.method==='POST'){window.__repairPosts.push(window.__repairMode);if(window.__repairMode==='refuse')return Response.json({error:{code:'usage',message:'Synthetic explicit refusal'}},{status:400});const r=await window.__realFetch(input,init);if(window.__repairMode==='ambiguous')throw new TypeError('Synthetic lost acknowledgement after acceptance');return r}if(u.pathname.endsWith('/cancel'))window.__cancelPosts.push(u.pathname);return window.__realFetch(input,init)}})()`);

  // Plan itself makes no agent request and opens the scoped request in the mounted chat.
  evalPage('document.querySelector(".br-marker").click()');
  wait(".br-panel");
  evalPage('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Plan a repair").click()');
  wait(".repair-request");
  let state = JSON.parse(evalPage(`(()=>{const r=document.querySelector('.repair-request');return {posts:window.__repairPosts.length,value:r.querySelector('textarea').value,scrollHeight:r.scrollHeight,clientHeight:r.clientHeight,overflow:getComputedStyle(r).overflowY,tabIndex:r.tabIndex}})()`));
  check(state.posts === 0, "Plan initiated an agent POST");
  check(state.value.includes("left index") && state.value.includes("Marked scope:"), "request lost the selected key's human-readable scope");
  check(state.overflow === "auto" && state.tabIndex >= 0 && state.scrollHeight > state.clientHeight, "phone repair request has no keyboard/touch scroll owner");
  browser("screenshot", `${evidence}/390-light-request-scroll.png`);
  browser("set", "viewport", "1440", "900");
  browser("screenshot", `${evidence}/1440-light-request-scroll.png`);
  browser("set", "viewport", "390", "844");
  const reachability = JSON.parse(evalPage(`(()=>{const r=document.querySelector('.repair-request');r.scrollTop=r.scrollHeight;const b=r.querySelector('button').getBoundingClientRect(),p=r.getBoundingClientRect();return {top:r.scrollTop,button:{top:b.top,bottom:b.bottom},panel:{top:p.top,bottom:p.bottom},viewport:innerHeight}})()`));
  check(reachability.top > 0 && reachability.button.top >= reachability.panel.top && reachability.button.bottom <= Math.min(reachability.panel.bottom, reachability.viewport), "Send cannot be scrolled fully into the phone viewport");

  // Home/unmount/remount retains the edited App-owned request for this same config.
  const edited = state.value + "\n\nUser edit: retain this exact sentence.";
  browser("fill", ".repair-request textarea", edited);
  browser("fill", ".repair-request textarea", `${edited}\n\n${"Long synthetic request detail. ".repeat(24)}`);
  const longText = JSON.parse(evalPage(`(()=>{const r=document.querySelector('.repair-request');r.scrollTop=r.scrollHeight;const b=r.querySelector('button').getBoundingClientRect(),p=r.getBoundingClientRect();return {height:r.clientHeight,scroll:r.scrollHeight,sendTop:b.top,sendBottom:b.bottom,panelTop:p.top,panelBottom:p.bottom}})()`));
  check(longText.scroll > longText.height && longText.sendTop >= longText.panelTop && longText.sendBottom <= longText.panelBottom, "long request detail cannot scroll to Send");
  browser("fill", ".repair-request textarea", edited);
  goHome();
  wait('button[aria-label*="Moonlander"]');
  evalPage('[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Open Moonlander")?.click()');
  browser("wait", ".topbar-ask");
  evalPage("if(document.querySelector('.topbar-ask')?.getAttribute('aria-pressed')==='false') document.querySelector('.topbar-ask').click()");
  wait(".repair-request");
  check(evalPage(`document.querySelector('.repair-request textarea').value===${JSON.stringify(edited)}`) === "true", "edited request was lost on Home and same-config return");
  check(JSON.parse(evalPage("window.__repairPosts.length")) === 0, "return from Home replayed the unsent request");

  // The request cannot bypass an occupied composer, and explicit 4xx refusal restores editability.
  browser("fill", 'textarea[aria-label="Message to keyloom"]', "keep the existing composer text");
  check(JSON.parse(evalPage("document.querySelector('.repair-request button').disabled")) === true, "occupied composer did not disable scoped Send");
  browser("focus", 'textarea[aria-label="Message to keyloom"]');
  evalPage("(()=>{const t=document.querySelector('textarea[aria-label=\"Message to keyloom\"]');t.focus();t.setSelectionRange(0,t.value.length)})()");
  browser("press", "Backspace");
  evalPage("window.__repairMode='refuse'");
  clickText("Send request");
  browser("wait", "--fn", "window.__repairPosts.length===1&&!document.querySelector('.repair-request button').disabled");
  state = JSON.parse(evalPage(`(()=>({posts:window.__repairPosts.slice(),disabled:document.querySelector('.repair-request button').disabled,editable:!document.querySelector('.repair-request textarea').disabled}))()`));
  check(state.posts.length === 1 && state.posts[0] === "refuse" && !state.disabled && state.editable, "definite refusal did not restore the unsent editable request");

  // Two activations in the same turn yield one POST; a response lost after server acceptance stays sent and is not replayed.
  evalPage("window.__repairMode='refuse';const b=document.querySelector('.repair-request button');b.click();b.click()");
  browser("wait", "--fn", "window.__repairPosts.length===2&&!document.querySelector('.repair-request button').disabled");
  check(JSON.parse(evalPage("window.__repairPosts.length")) === 2, "double activation submitted more than once");
  evalPage("window.__repairMode='ambiguous'");
  clickText("Send request");
  browser("wait", "--text", "Already sent");
  state = JSON.parse(evalPage(`(()=>({posts:window.__repairPosts.slice(),disabled:document.querySelector('.repair-request button').disabled,text:document.querySelector('.repair-request').innerText}))()`));
  check(state.posts.length === 3 && state.posts[2] === "ambiguous" && state.disabled, "ambiguous acceptance became resendable");
  goHome();
  wait('button[aria-label="Open Moonlander"]');
  evalPage('document.querySelector("button[aria-label=\\"Open Moonlander\\"]").click()');
  browser("wait", ".topbar-ask");
  evalPage("if(document.querySelector('.topbar-ask')?.getAttribute('aria-pressed')==='false') document.querySelector('.topbar-ask').click()");
  wait(".repair-request");
  check(JSON.parse(evalPage("window.__repairPosts.length")) === 3, "an uncertain accepted request replayed after remount");
  check(JSON.parse(evalPage("document.querySelector('.repair-request .sheet-action').textContent.trim()")) === "Dismiss request", "sent request control falsely claims to cancel the running/completed agent");
  check(JSON.parse(evalPage("window.__cancelPosts.length")) === 0, "dismissing request context canceled the agent run");
  browser("screenshot", `${evidence}/390-light-sent-no-replay.png`);

  // Controlled dismissal response: while a hide is outstanding the old finding cannot be sent.
  clickText("Dismiss request");
  clickText("Board review: 1 hint");
  clickText("Plan a repair");
  wait(".repair-request");
  clickText("Board review: 1 hint");
  evalPage(`(()=>{window.__dismissStarted=false;window.__releaseDismiss=null;const real=window.__realFetch;window.fetch=(input,init={})=>{const u=new URL(typeof input==='string'?input:input.url,location.origin);if(u.pathname.endsWith('/dismiss')&&init.method==='POST'){window.__dismissStarted=true;return new Promise(resolve=>{window.__releaseDismiss=()=>real(input,init).then(resolve)})}return real(input,init)}})()`);
  clickText("Hide");
  wait(".br-panel");
  browser("wait", "--fn", "window.__dismissStarted===true");
  clickText("Close the review");
  browser("wait", ".topbar-ask");
  evalPage("if(document.querySelector('.topbar-ask')?.getAttribute('aria-pressed')==='false') document.querySelector('.topbar-ask').click()");
  wait(".repair-request");
  check(JSON.parse(evalPage("document.querySelector('.repair-request button').disabled")) === true, "Send remained enabled while finding dismissal was pending");
  evalPage("window.__releaseDismiss()");
  browser("wait", "--text", "This finding is no longer current");
  check(JSON.parse(evalPage("document.querySelector('.repair-request button').disabled")) === true, "hidden finding remained sendable after dismissal completed");
  browser("screenshot", `${evidence}/390-light-hidden-finding-disabled.png`);
  const receipt = { result: "PASS", checks: ["Plan makes no agent POST", "composer occupancy disables scoped Send", "short and long request scrolls reach Send at 390x844", "edited request survives Home and same-config return", "explicit refusal restores an editable unsent request", "same-turn double activation yields one POST", "ambiguous accepted POST is never replayed after Home", "sent-request dismissal does not cancel the run", "pending and completed finding dismissal keep Send disabled"] };
  await Bun.write(`${evidence}/lifecycle-proof.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  browser("close");
}
