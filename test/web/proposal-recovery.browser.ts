// Run with proposal-recovery-server.ts. Persisted real App routes; only provider responses are fake.
import { mkdirSync } from "node:fs";
export {};
const evidence = process.argv[2];
if (!evidence) throw new Error("Pass assigned evidence directory");
mkdirSync(evidence, { recursive: true });
const fixture = await Bun.file(`${evidence}/fixture.json`).json();
const session = `keyloom-rung2b-proof-${process.pid}`;
function b(...args: string[]) { const p = Bun.spawnSync(["agent-browser", "--session", session, ...args]); if (p.exitCode) throw new Error(p.stdout.toString() + p.stderr.toString()); return p.stdout.toString().trim(); }
const e = (code: string) => b("eval", code);
const click = (name: string) => e(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')??b.textContent.trim())===${JSON.stringify(name)});if(!b)throw new Error('Missing button');b.click()})()`);
const check = (value: boolean, message: string) => { if (!value) throw new Error(message); };
const value = () => JSON.parse(e("document.querySelector('.repair-request textarea').value"));
const posts = () => JSON.parse(e("window.__posts.length"));
const openChat = () => e("if(document.querySelector('.topbar-ask')?.getAttribute('aria-pressed')==='false')document.querySelector('.topbar-ask').click()");
const openHistory = () => { openChat(); b("wait", "--load", "networkidle"); b("wait", "--fn", "document.querySelector('.topbar-ask')?.getAttribute('aria-pressed')==='true'"); e("document.querySelector('.chat button[aria-label=More]').click()"); b("wait", "--fn", "[...document.querySelectorAll('[role=menuitem]')].some(b=>b.textContent.includes('Conversations'))"); e("[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.includes('Conversations')).click()"); };
const openConversation = (prefix: string) => { openHistory(); b("wait", "--fn", `Array.from(document.querySelectorAll('.chat button')).some(x=>x.textContent.includes(${JSON.stringify(prefix)}))`); e(`[...document.querySelectorAll('.chat button')].find(x=>x.textContent.includes(${JSON.stringify(prefix)})).click()`); b("wait", "--fn", `[...document.querySelectorAll('.chat .msg-user')].some(x=>x.textContent.includes(${JSON.stringify(prefix)}))`); };
const switchConfig = (name: string) => { click("Choose a config"); b("wait", '[role="menuitemradio"]'); e(`[...document.querySelectorAll('[role=menuitemradio]')].find(b=>b.textContent.includes(${JSON.stringify(name)})).click()`); b("wait", "--fn", `document.querySelector('.layout-trigger-name')?.textContent===${JSON.stringify(name)}`); };
const api = (id: string) => JSON.parse(JSON.parse(e(`fetch('/api/layouts/${id}',{headers:{'x-keyloom-token':'proposal-recovery-synthetic-token'}}).then(r=>r.json()).then(JSON.stringify)`)));
async function capture(name: string) {
  for (const [width, height] of [[1440, 900], [390, 844]]) for (const theme of ["light", "dark"]) {
    b("set", "viewport", String(width), String(height));
    b("set", "media", theme, "reduced-motion");
    if (name === "unsaved-refusal") openConversation("Distinctive original refusal goal");
    if (name === "replacement-preview") openConversation("Please plan a revised proposal");
    e(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    b("screenshot", `${evidence}/${width}-${theme}-${name}.png`);
  }
  b("set", "viewport", "1440", "900");
  if (name === "unsaved-refusal") openConversation("Distinctive original refusal goal");
  if (name === "replacement-preview") openConversation("Please plan a revised proposal");
}
try {
  b("set", "viewport", "1440", "900");
  b("open", "http://127.0.0.1:4531/?t=proposal-recovery-synthetic-token");
  b("wait", 'button[aria-label="Open Moonlander"]'); e(`document.querySelector('button[aria-label="Open Moonlander"]').click()`); b("wait", ".topbar-ask"); b("wait", "--load", "networkidle");
  e(`(()=>{window.__posts=[];window.__cancels=[];window.__mode='normal';window.__fetch=fetch.bind(window);window.fetch=async(i,n={})=>{const u=new URL(typeof i==='string'?i:i.url,location.origin);if(u.pathname==='/api/agent/v1/runs'&&n.method==='POST'){window.__posts.push(JSON.parse(n.body));if(window.__mode==='refuse')return Response.json({error:{code:'usage',message:'Synthetic explicit send refusal'}},{status:400});const r=await window.__fetch(i,n);if(window.__mode==='ambiguous')throw new TypeError('Lost accepted acknowledgement');return r}if(u.pathname.endsWith('/cancel'))window.__cancels.push(u.pathname);return window.__fetch(i,n)}})()`);
  openConversation("Distinctive original stale goal");
  const staleBefore = api(fixture.stale.layoutId);
  e("document.querySelector('.proposal .bar-apply').click()"); b("wait", "--text", "no longer applies cleanly");
  click("Plan a revised proposal"); b("wait", ".repair-request");
  check(value().includes("Distinctive original stale goal") && !value().includes("Unrelated later request"), "recovery borrowed unrelated latest goal");
  check(posts() === 0, "Plan sent a request");
  const edited = value() + "\n\nRetain this exact user edit.";
  b("fill", ".repair-request textarea", edited);
  click("Pegboard Home"); b("wait", 'button[aria-label="Open Moonlander"]'); e(`document.querySelector('button[aria-label="Open Moonlander"]').click()`); b("wait", ".topbar-ask"); openChat(); b("wait", ".repair-request");
  check(value() === edited && posts() === 0, "Home lost or replayed request");
  b("fill", 'textarea[aria-label="Message to keyloom"]', "occupied composer");
  check(JSON.parse(e("document.querySelector('.repair-request button').disabled")), "occupied composer allowed Send");
  b("fill", ".repair-request textarea", "x".repeat(8001));
  check(JSON.parse(e("document.querySelector('.repair-request button').disabled")), "overlong request allowed Send");
  await capture("blocked-long-request");
  b("fill", ".repair-request textarea", edited);
  e("const t=document.querySelector('textarea[aria-label=\"Message to keyloom\"]');t.focus();t.setSelectionRange(0,t.value.length)"); b("press", "Backspace");
  e("window.__mode='refuse'"); click("Send request"); b("wait", "--fn", "window.__posts.length===1&&!document.querySelector('.repair-request button').disabled");
  check(value() === edited, "explicit refusal lost edits");
  e("const b=document.querySelector('.repair-request button');b.click();b.click()"); b("wait", "--fn", "window.__posts.length===2&&!document.querySelector('.repair-request button').disabled");
  check(posts() === 2, "double activation duplicated Send");
  e("window.__mode='normal'"); click("Send request"); b("wait", "--text", "Revised F17 proposal"); b("wait", "--fn", "document.querySelector('.chat')?.dataset.streaming==='false'");
  check(JSON.stringify(api(fixture.stale.layoutId).revision) === JSON.stringify(staleBefore.revision), "preview changed persisted head");
  await capture("replacement-preview"); e("document.querySelector('.proposal .bar-apply').click()"); b("wait", "--load", "networkidle"); openChat(); b("wait", "[data-status=applied]");
  const staleAfter = api(fixture.stale.layoutId);
  check(staleAfter.document.layers[0].bindings[33].code === "F17", "stale replacement did not apply");
  check(JSON.stringify(staleAfter.document.layers[0].bindings[36]) === JSON.stringify(staleBefore.document.layers[0].bindings[36]), "neighbor changed");
  switchConfig("Refused synthetic goal"); openConversation("Distinctive original refusal goal");
  b("wait", "--text", "exact affected target was not recorded");
  check(JSON.parse(e("document.querySelectorAll('.proposal').length")) === 0, "unsaved refusal fabricated a card");
  await capture("unsaved-refusal");
  const refusedBefore = api(fixture.refused.layoutId);
  const countBefore = posts(); click("Plan a revised proposal"); b("wait", ".repair-request");
  check(value().includes("Distinctive original refusal goal") && posts() === countBefore, "unsaved Plan lost goal or sent");
  await capture("refusal-request");
  openConversation("Distinctive original refusal goal");
  click("Plan a revised proposal"); b("wait", "--text", "Finish or dismiss");
  check(value().includes("Distinctive original refusal goal"), "pending request overwritten");
  click("Send request"); b("wait", "--text", "Revised F17 proposal"); b("wait", "--fn", "document.querySelector('.chat')?.dataset.streaming==='false'");
  check(JSON.stringify(api(fixture.refused.layoutId).revision) === JSON.stringify(refusedBefore.revision), "unsaved replacement preview wrote head");
  e("document.querySelector('.proposal .bar-apply').click()"); b("wait", "--load", "networkidle"); openChat(); b("wait", "[data-status=applied]");
  const refusedAfter = api(fixture.refused.layoutId);
  check(refusedAfter.document.layers[0].bindings[33].code === "F17", "unsaved replacement did not apply");
  check(JSON.stringify(refusedAfter.document.layers[0].bindings[36]) === JSON.stringify(refusedBefore.document.layers[0].bindings[36]), "unsaved neighbor changed");
  await Bun.write(`${evidence}/persisted-journeys.json`, JSON.stringify({ result: "PASS", session, staleBefore: staleBefore.revision, staleAfter: staleAfter.revision, refusedBefore: refusedBefore.revision, refusedAfter: refusedAfter.revision, target: 33, neighbor: 36, neighborUnchanged: true, previewReadOnly: true }, null, 2));
  // A pending recovery is config-owned, and another plan cannot replace it.
  openConversation("Distinctive original refusal goal"); click("Plan a revised proposal"); b("wait", ".repair-request");
  const kept = value(); switchConfig("Stale synthetic goal"); openChat();
  check(JSON.parse(e("document.querySelector('.repair-request')===null")), "request leaked to another config");
  switchConfig("Refused synthetic goal"); openChat(); b("wait", ".repair-request"); check(value() === kept, "config return lost request");
  // Hold a read-only source recheck, replace the unsent draft, then release the old completion.
  e(`(()=>{window.__holdRead=true;window.__releaseRead=null;const real=window.fetch.bind(window);window.fetch=async(i,n={})=>{const u=new URL(typeof i==='string'?i:i.url,location.origin);if(window.__holdRead&&u.pathname==='/api/conversations/${fixture.refusal.conversationId}'){window.__holdRead=false;await new Promise(resolve=>window.__releaseRead=resolve)}return real(i,n)}})()`);
  const beforeOldRead = posts(); click("Send request"); b("wait", "--fn", "window.__releaseRead!==null"); click("Cancel");
  openConversation("Distinctive original refusal goal"); click("Plan a revised proposal"); b("wait", ".repair-request");
  b("fill", ".repair-request textarea", kept + "\nNew draft owns this text."); e("window.__releaseRead()"); b("wait", "--load", "networkidle");
  check(posts() === beforeOldRead && value().includes("New draft owns this text"), "old source read sent or cleared newer request");
  // Accept once, lose its acknowledgement, then Home and Stop must not replay it.
  e(`window.fetch=async(i,n={})=>{const u=new URL(typeof i==='string'?i:i.url,location.origin);if(u.pathname==='/api/agent/v1/runs'&&n.method==='POST'){window.__posts.push(JSON.parse(n.body));const r=await window.__fetch(i,n);throw new TypeError('Lost accepted acknowledgement')}if(u.pathname.endsWith('/cancel'))window.__cancels.push(u.pathname);return window.__fetch(i,n)}`);
  click("Send request"); b("wait", "--text", "Already sent"); const acceptedPosts = posts();
  click("Pegboard Home"); b("wait", 'button[aria-label="Open Moonlander"]'); click("Open Moonlander"); b("wait", ".topbar-ask"); b("wait", "--load", "networkidle"); if (JSON.parse(e("document.querySelector('.layout-trigger-name').textContent")) !== "Refused synthetic goal") switchConfig("Refused synthetic goal"); openChat(); b("wait", ".repair-request");
  check(posts() === acceptedPosts && JSON.parse(e("document.querySelector('.repair-request button').disabled")), "ambiguous accepted POST replayed after Home");
  check(JSON.parse(e("document.querySelector('.repair-request .sheet-action').textContent.trim()")) === "Dismiss request", "sent-context dismissal falsely offers cancellation");
  click("Dismiss request"); check(posts() === acceptedPosts, "Dismiss replayed accepted work");
  // Opening recovery during an ordinary active send must not cancel its observation.
  openConversation("Distinctive original refusal goal");
  e(`(()=>{window.__releaseAcceptance=null;window.fetch=async(i,n={})=>{const u=new URL(typeof i==='string'?i:i.url,location.origin);if(u.pathname==='/api/agent/v1/runs'&&n.method==='POST'){window.__posts.push(JSON.parse(n.body));await window.__fetch(i,n);await new Promise(resolve=>window.__releaseAcceptance=resolve);throw new TypeError('Lost acknowledgement after deliberate Stop')}if(u.pathname.endsWith('/cancel'))window.__cancels.push(u.pathname);return window.__fetch(i,n)}})()`);
  b("fill", 'textarea[aria-label="Message to keyloom"]', "lifecycle ordinary active request"); b("press", "Enter"); b("wait", "--fn", "window.__releaseAcceptance!==null");
  const activePosts = posts(); const cancelsBeforePlan = JSON.parse(e("window.__cancels.length"));
  click("Plan a revised proposal"); b("wait", ".repair-request");
  check(posts() === activePosts && JSON.parse(e("window.__cancels.length")) === cancelsBeforePlan && JSON.parse(e("document.querySelector('.repair-request button').disabled")), "Plan sent or cancelled active work");
  click("Stop"); b("wait", "--fn", `window.__cancels.length===${cancelsBeforePlan + 1}`); e("window.__releaseAcceptance()"); b("wait", "--fn", "document.querySelector('.chat')?.dataset.streaming==='false'");
  check(posts() === activePosts, "Stop replayed accepted work"); click("Cancel");
  // A current-head change makes the next unsent recovery non-sendable without losing its goal.
  openConversation("Distinctive original refusal goal"); click("Plan a revised proposal"); b("wait", ".repair-request");
  const head = api(fixture.refused.layoutId).revision.id;
  const advance = JSON.parse(JSON.parse(e(`window.__fetch('/api/layouts/${fixture.refused.layoutId}/apply',{method:'POST',headers:{'x-keyloom-token':'proposal-recovery-synthetic-token','content-type':'application/json'},body:JSON.stringify({baseRevisionId:${JSON.stringify(head)},summary:'Synthetic head invalidation',ops:[{op:'dropFunction',function:'key:F17',reason:'Synthetic replacement'},{op:'setBinding',at:{layerId:'layer-0',position:33},binding:{kind:'key',code:'F18'}}]})}).then(async r=>JSON.stringify({ok:r.ok,body:await r.json()}))`)));
  check(advance.ok, "synthetic head advancement failed"); const beforeStaleSend = posts(); click("Send request"); b("wait", "--text", "layout or source changed");
  check(posts() === beforeStaleSend && value().includes("Distinctive original refusal goal"), "changed head sent or lost goal");
  await Bun.write(`${evidence}/journey-receipt.json`, JSON.stringify({ result: "PASS", session, staleBefore: staleBefore.revision, staleAfter: staleAfter.revision, refusedBefore: refusedBefore.revision, refusedAfter: refusedAfter.revision, checks: ["genuine persisted validator refusal without proposal card", "actual stale Apply refusal", "source-specific original goals", "Plan no POST", "Home retains edited request", "occupied composer and long request blocked", "occupied pending request preserved", "explicit send refusal preserves edits", "double activation one POST", "both previews read-only", "both explicit Applies change F17 only; neighbor unchanged"] }, null, 2));
  console.log("PASS persisted recovery journeys and first-round mounted lifecycle checks");
} catch (error) { console.error(String(error)); console.error(b("snapshot", "-i")); console.error(e("document.body.innerText.slice(-3000)")); throw error; }
finally { b("close"); }
