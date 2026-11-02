// Terminal 1: bun test/web/review-clarity-server.ts
// Terminal 2: bun test/web/review-clarity.browser.ts [screenshot-directory]
import { mkdirSync } from "node:fs";
export {};

const session = Bun.spawnSync(["agent-browser", "session", "id", "--scope", "worktree", "--prefix", "review-clarity"]).stdout.toString().trim();
const evidence = process.argv[2];
if (evidence) mkdirSync(evidence, { recursive: true });
function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args[0]} failed: ${result.stdout}${result.stderr}`);
  return result.stdout.toString();
}
const url = "http://127.0.0.1:4531/?t=dev-editor-token";
try {
  for (const [width, height] of [[1440, 900], [1100, 577], [390, 844]] as const) for (const theme of ["light", "dark"]) {
    browser("set", "viewport", String(width), String(height));
    browser("open", url);
    browser("wait", ".br-marker");
    browser("eval", `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.br-marker').click()`);
    browser("wait", ".br-change-table");
    browser("eval", `(()=>{const summary=[...document.querySelectorAll('.br-panel summary')].find(el=>el.textContent.includes('Keys whose bindings change'));summary?.click()})()`);
    browser("eval", `(()=>{const panel=document.querySelector('.br-panel'),text=panel.innerText;if(!text.includes('Current')||!text.includes('Proposed')||!text.includes('Tapping term')||!text.includes('200 ms')||!text.includes('240 ms')||!text.includes('Hold trigger keys')||!text.includes('40 positions')||!text.includes('Keys whose bindings change (2)')||text.includes('Legacy generated prose'))throw Error('live comparison missing expected source facts');const r=panel.getBoundingClientRect();if(r.left<0||r.right>innerWidth+1||panel.scrollWidth>panel.clientWidth+1)throw Error('panel overflow');})()`);
    browser("eval", `(()=>{const all=[...document.querySelectorAll('.br-panel summary')].find(el=>el.textContent==='All values');if(!all)throw Error('expanded numeric values are unavailable');all.click()})()`);
    browser("eval", `(()=>{const detail=[...document.querySelectorAll('.br-value-details')].find(el=>el.open);if(!detail?.innerText.includes('40'))throw Error('full profile position set is not inspectable')})()`);
    console.log(`PASS ${width}×${height} ${theme}: linked proposal comparisons render inside the review panel`);
    if (evidence) browser("screenshot", `${evidence}/${width}-${height}-${theme}.png`);
  }
  // Inspect the additional supported comparison categories and the same-legend hold retarget.
  browser("set", "viewport", "1440", "900");
  browser("open", url); browser("wait", ".br-marker");
  browser("eval", "document.querySelector('.br-marker').click()"); browser("wait", ".br-change-table");
  browser("eval", `(()=>{const cards=[...document.querySelectorAll('.br-item[data-kind="suggestion"]')],combo=cards.find(card=>card.innerText.includes('Create the Save shortcut combo')),native=cards.find(card=>card.innerText.includes('Retarget the Magic hold layer'));if(cards.length!==3||!combo||!native)throw Error('three supported synthetic proposals are not linked to the review');const comboText=combo.innerText;if(!comboText.includes('Save shortcut')||!comboText.includes('All layers')||!comboText.includes('Sends Left Ctrl + S')||!comboText.includes('45 ms'))throw Error('combo comparison is missing material values');const summary=[...native.querySelectorAll('.br-scope-details summary')].find(el=>el.textContent.includes('Keys whose bindings change'));summary?.click();const nativeText=native.innerText,legends=[...native.querySelectorAll('.br-binding-change .br-binding-side .mini-cap')].map(el=>el.textContent);if(!nativeText.includes('Tap Enter bootloader; hold to use Navigation')||!nativeText.includes('Tap Enter bootloader; hold to use Numbers')||nativeText.includes('{layer:')||nativeText.includes('"kind":"')||legends.length!==2||legends[0]!=='Magic'||legends[1]!=='Magic')throw Error('native hold effect comparison is not human-readable, preserves the same legend, or is serialized');})()`);
  browser("eval", `(()=>{const body=document.querySelector('.br-body'),combo=[...document.querySelectorAll('.br-item[data-kind="suggestion"]')].find(card=>card.innerText.includes('Create the Save shortcut combo'));combo.scrollIntoView({block:'center'});const rect=combo.getBoundingClientRect();if(rect.right>innerWidth+1||rect.left<0)throw Error('combo comparison card is out of bounds')})()`);
  if (evidence) browser("screenshot", `${evidence}/combo-comparison.png`);
  browser("eval", `(()=>{const body=document.querySelector('.br-body'),native=[...document.querySelectorAll('.br-item[data-kind="suggestion"]')].find(card=>card.innerText.includes('Retarget the Magic hold layer'));native.scrollIntoView({block:'center'});})()`);
  if (evidence) browser("screenshot", `${evidence}/native-retarget-comparison.png`);
  browser("set", "viewport", "390", "844");
  browser("open", url); browser("wait", ".br-marker"); browser("eval", "document.querySelector('.br-marker').click()"); browser("wait", ".br-change-table");
  browser("eval", `(()=>{const body=document.querySelector('.br-body'),combo=[...document.querySelectorAll('.br-item[data-kind="suggestion"]')].find(card=>card.innerText.includes('Create the Save shortcut combo'));combo.scrollIntoView({block:'end'});const r=combo.querySelector('.br-actions .bar-apply').getBoundingClientRect(),b=body.getBoundingClientRect();if(r.top<b.top||r.bottom>b.bottom)throw Error('phone scrolled state does not show the comparison action controls')})()`);
  if (evidence) browser("screenshot", `${evidence}/390-844-scrolled-comparison-controls.png`);

  // Preview the accepted profile proposal read-only. Then keyboard-activate Apply and confirm a new revision.
  browser("set", "viewport", "1440", "900");
  browser("open", url); browser("wait", ".br-marker"); browser("eval", "document.querySelector('.br-marker').click()"); browser("wait", ".br-change-table");
  browser("eval", `(()=>{const profile=[...document.querySelectorAll('.br-item[data-kind="suggestion"]')].find(card=>card.innerText.includes('Change a key and tune tap/hold settings'));if(!profile)throw Error('profile acceptance proposal is missing');fetch('/api/layouts/glove80-daily',{headers:{'X-Keyloom-Token':'dev-editor-token'}}).then(r=>r.json()).then(x=>window.__before=x);profile.querySelector('button[aria-pressed="false"][class*="sheet-action"]').click()})()`);
  browser("wait", "[data-pinned='true']");
  if (evidence) browser("screenshot", `${evidence}/preview-before-apply.png`);
  browser("eval", `fetch('/api/layouts/glove80-daily',{headers:{'X-Keyloom-Token':'dev-editor-token'}}).then(r=>r.json()).then(x=>window.__afterPreview=x);const profile=[...document.querySelectorAll('.br-item[data-kind="suggestion"]')].find(card=>card.innerText.includes('Change a key and tune tap/hold settings')),button=profile?.querySelector('.br-actions .bar-apply');if(!button||button.disabled)throw Error('Apply is not reachable');button.focus()`);
  browser("wait", "--fn", "window.__afterPreview !== undefined");
  browser("eval", "if(window.__afterPreview.revision.id!==window.__before.revision.id)throw Error('preview persisted a write')");
  browser("press", "Enter"); browser("wait", "--fn", "document.querySelector('.br-item[data-kind=\"suggestion\"][data-stale=\"true\"]') !== null");
  browser("eval", `fetch('/api/layouts/glove80-daily',{headers:{'X-Keyloom-Token':'dev-editor-token'}}).then(r=>r.json()).then(x=>window.__applied=x)`);
  browser("wait", "--fn", "window.__applied !== undefined");
  browser("eval", "if(window.__applied.revision.id===window.__before.revision.id)throw Error('Apply did not persist a revision');if(window.__applied.document.layers[0].bindings[14].code!=='N5'||window.__applied.document.layers[0].bindings[15].code!=='N4'||!window.__applied.document.holdTapProfiles.some(p=>p.options['tapping-term-ms']===240&&p.options['hold-trigger-key-positions'].length===40))throw Error('persisted layout does not match proposal ops')");
  console.log("PASS keyboard preview is read-only; Enter on Apply persists the exact synthetic key/profile ops");
} finally { browser("close"); }
