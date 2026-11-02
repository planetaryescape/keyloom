// Run against proposal-recovery-corrections-server.ts in matching app|cards mode on port 4531.
import { mkdirSync } from "node:fs";
export {};
const evidence = process.argv[2]; const mode = process.argv[3] ?? "app";
if (!evidence || !["app", "cards"].includes(mode)) throw new Error("Pass assigned evidence directory and app|cards");
mkdirSync(evidence, { recursive: true });
const session = `keyloom-rung2b-correction-${mode}-${process.pid}`;
function b(...args: string[]) { const p = Bun.spawnSync(["agent-browser", "--session", session, ...args]); if (p.exitCode) throw new Error(p.stdout.toString() + p.stderr.toString()); return p.stdout.toString().trim(); }
const e = (code: string) => b("eval", code);
const check = (value: boolean, message: string) => { if (!value) throw new Error(message); };
const click = (name: string) => e(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')??b.textContent.trim())===${JSON.stringify(name)});if(!b)throw new Error('Missing button: '+${JSON.stringify(name)});b.click()})()`);
const openChat = () => { e("if(document.querySelector('.topbar-ask')?.getAttribute('aria-pressed')==='false')document.querySelector('.topbar-ask').click()"); b("wait", "--load", "networkidle"); };
const openConfig = () => { b("wait", 'button[aria-label="Open Moonlander"]'); click("Open Moonlander"); b("wait", ".topbar-ask"); b("wait", "--load", "networkidle"); openChat(); };
const openSource = () => {
  openChat(); e("document.querySelector('.chat button[aria-label=More]').click()"); b("wait", '[role="menuitem"]');
  e("[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.includes('Conversations')).click()");
  b("wait", "--fn", "[...document.querySelectorAll('.chat button')].some(b=>b.textContent.includes('Distinctive original F17 goal'))");
  e("[...document.querySelectorAll('.chat button')].find(b=>b.textContent.includes('Distinctive original F17 goal')).click()");
  b("wait", "--fn", "[...document.querySelectorAll('.chat .msg-user')].some(b=>b.textContent.includes('Distinctive original F17 goal'))");
};
const countPosts = () => e("(()=>{window.__posts=[];const real=fetch.bind(window);window.fetch=(i,n={})=>{if(n.method==='POST'&&new URL(typeof i==='string'?i:i.url,location.origin).pathname==='/api/agent/v1/runs')window.__posts.push(JSON.parse(n.body));return real(i,n)}})()");
const goal = "Distinctive original F17 goal: put F17 on my index finger";
try {
  b("set", "viewport", "1440", "900"); b("set", "media", "light", "reduced-motion");
  if (mode === "app") {
    const fixture = await Bun.file(`${evidence}/correction-fixture-app.json`).json();
    const api = (path: string) => JSON.parse(JSON.parse(e(`fetch(${JSON.stringify(path)},{headers:{'x-keyloom-token':'correction-synthetic-token'}}).then(r=>r.json()).then(JSON.stringify)`)));
    b("open", "http://127.0.0.1:4531/?t=correction-synthetic-token"); openConfig(); openSource(); b("wait", ".ask-option");
    b("screenshot", `${evidence}/correction-question.png`);
    countPosts(); b("focus", ".ask-option"); b("press", "Enter");
    b("wait", "--text", "exact affected target was not recorded"); b("wait", "--fn", "document.querySelector('.chat').dataset.streaming==='false'");
    check(JSON.parse(e("window.__posts.length")) === 1, "answer was not exactly one deliberate request");
    const detail = api(`/api/conversations/${fixture.first.conversationId}`);
    check(detail.proposals.length === 0, "refused answer saved a proposal");
    const refusal = detail.presentations.find((p: { operations: { tool: string; status: string }[] }) => p.operations.some((op) => op.tool === "propose_changes" && op.status === "declined"));
    check(refusal?.userMessageId !== fixture.first.messageIds[0], "refusal was not answer-owned");
    b("fill", 'textarea[aria-label="Message to keyloom"]', "Unrelated later request about colors"); b("press", "Enter");
    b("wait", "--text", "Unrelated request about colors acknowledged"); b("wait", "--fn", "document.querySelector('.chat').dataset.streaming==='false'");
    b("reload"); openConfig(); openSource(); b("wait", "--text", "exact affected target was not recorded"); countPosts();
    b("screenshot", `${evidence}/correction-reloaded-refusal.png`);
    const before = api(`/api/layouts/${fixture.layoutId}`);
    b("focus", ".proposal-problem .bar-link"); b("press", "Enter"); b("wait", ".repair-request textarea");
    const request = JSON.parse(e("document.querySelector('.repair-request textarea').value"));
    check(request.includes(goal) && request.includes("Answer to “Which hand do you prefer?”: Left"), "recovery lost original goal or answer");
    check(!request.includes("Unrelated later request"), "recovery borrowed latest unrelated request");
    check(JSON.parse(e("window.__posts.length")) === 0, "opening recovery sent a request");
    e("document.querySelector('.repair-request details').open=true");
    b("screenshot", `${evidence}/correction-request-with-lineage.png`);
    e("document.querySelector('.repair-request').scrollTop=document.querySelector('.repair-request').scrollHeight");
    b("focus", ".repair-request .bar-apply"); b("press", "Enter");
    b("wait", "--text", "Revised F17 after the hand answer"); b("wait", "--fn", "document.querySelector('.chat').dataset.streaming==='false'");
    check(JSON.parse(e("window.__posts.length")) === 1, "explicit recovery Send did not submit exactly once");
    const preview = api(`/api/layouts/${fixture.layoutId}`);
    check(preview.revision.id === before.revision.id, "preview wrote a revision");
    e("document.querySelector('.proposal .bar-apply').click()"); b("wait", "--load", "networkidle"); openChat(); b("wait", "[data-status=applied]");
    const after = api(`/api/layouts/${fixture.layoutId}`);
    check(after.document.layers[0].bindings[33].code === "F17", "explicit Apply did not set F17");
    check(JSON.stringify(after.document.layers[0].bindings[36]) === JSON.stringify(before.document.layers[0].bindings[36]), "neighbor changed");
    await Bun.write(`${evidence}/correction-question-journey.json`, JSON.stringify({ result: "PASS", session, goal, question: fixture.first.question.question, answer: "Left", refusalOwner: refusal.userMessageId, originalOwner: fixture.first.messageIds[0], request, revisionBefore: before.revision.id, revisionPreview: preview.revision.id, revisionAfter: after.revision.id, neighborUnchanged: true, planPosts: 0, explicitSendPosts: 1, sourceConversationId: fixture.first.conversationId, checks: ["actual keyboard-activated question answer", "actual unsaved validator refusal", "later unrelated request excluded", "reload reconstructs source", "keyboard Plan sends nothing", "keyboard Send exactly once", "preview read-only", "explicit Apply F17 only"] }, null, 2));
  } else {
    b("open", "http://127.0.0.1:4531"); b("wait", ".proposal");
    for (const full of [false, true]) {
      if (full) click("Use full card");
      check(JSON.parse(e("document.querySelectorAll('.issue-error,.proposal-notes[data-tone=error]').length")) === 0, "Applied addLayer was incorrectly revalidated");
      check(JSON.parse(e("document.querySelector('.proposal').textContent.includes('Applied')")), "Applied history state missing");
    }
    click("Missing layer"); b("wait", "--text", "F17 on removed target layer");
    for (const compact of [false, true]) {
      if (compact) click("Use compact card");
      check(JSON.parse(e("[...document.querySelectorAll('.proposal button')].find(b=>b.textContent.trim().startsWith('Apply')).disabled")), "current-invalid Apply enabled");
      check(JSON.parse(e("document.querySelector('.proposal').textContent.includes('Plan a revised proposal')")), "current-invalid recovery absent");
    }
    for (const full of [false, true]) {
      click("Native confirmation"); if (full) click("Use full card");
      e("[...document.querySelectorAll('.proposal button')].find(b=>b.textContent.trim().startsWith('Apply')).click()"); b("wait", '[role="alertdialog"]');
      check(!JSON.parse(e("[...document.querySelectorAll('.proposal button')].find(b=>b.textContent.trim().startsWith('Replace and apply')).disabled")), "valid native confirmation blocked");
      click("Advance synthetic head");
      b("wait", "--fn", "[...document.querySelectorAll('.proposal button')].find(b=>b.textContent.trim().startsWith('Replace and apply')).disabled");
      e("[...document.querySelectorAll('.proposal button')].find(b=>b.textContent.trim().startsWith('Replace and apply')).click()");
      check(JSON.parse(e("document.querySelector('output').textContent")) === "0", "known-invalid confirmation called Apply handler");
      b("screenshot", `${evidence}/correction-${full ? "full" : "compact"}-confirmation-disabled.png`);
    }
    await Bun.write(`${evidence}/correction-mounted-cards.json`, JSON.stringify({ result: "PASS", session, checks: ["actual applied addLayer has no replay errors compact/full", "actual removed target layer disables Apply compact/full", "valid native confirmation remains available", "actual head change disables already-open confirmation compact/full", "disabled confirmation never calls Apply handler"] }, null, 2));
  }
  console.log(`PASS correction ${mode} mounted proof`);
} catch (error) { console.error(String(error)); console.error(b("snapshot", "-i")); throw error; }
finally { b("close"); }
