// Real synthetic App/Viewer geometry and carried-thread regression. Never use a real data server.
// Terminal 1: bun test/web/chat-controls-server.ts 4512
// Terminal 2: bun test/web/chat-controls.browser.ts
import { mkdirSync, writeFileSync } from "node:fs";
export {};
const session = "keyloom-model-picker-viewport";
const url = "http://127.0.0.1:4512/?t=dev-editor-token";
const evidence = process.argv[2] ?? "/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/model-picker-viewport";
mkdirSync(evidence, { recursive: true });
function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")}: ${result.stdout}${result.stderr}`);
  return result.stdout.toString();
}
function check(name: string, body: string): void {
  browser("eval", `(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);${body}})()`);
  console.log(`PASS ${name}`);
}
function menu(): void {
  check("stable controls", "if(!document.querySelector('.chat textarea')?.checkVisibility())throw Error('chat hidden');");
  browser("eval", "document.querySelector('.chat .bar-more').focus()");
  browser("press", "Enter");
  browser("wait", "[role=menuitem]");
}
function choose(name: string): void { browser("find", "role", "menuitem", "click", "--name", name); }
function openChat(): void {
  check("Viewer chrome mounted", "");
  browser("wait", ".topbar-ask");
  browser("eval", "if(document.querySelector('.topbar-ask').getAttribute('aria-pressed')!=='true')document.querySelector('.topbar-ask').click()");
  browser("wait", "--fn", "document.querySelector('.chat textarea')?.checkVisibility()");
}
function selectBoard(name: string, phone: boolean): void {
  check("board controls ready", "");
  if (phone) { browser("eval", "document.querySelector('[aria-label=\"Choose a board\"]').focus()"); browser("press", "Enter"); browser("wait", "[role=menuitemradio]"); browser("find", "role", "menuitemradio", "click", "--name", name, "--exact"); }
  else browser("find", "role", "button", "click", "--name", name, "--exact");
}
const rectangles: string[] = [];
function removePopoverSupport(): void {
  browser("eval", "Object.defineProperty(HTMLElement.prototype,'showPopover',{value:undefined,configurable:true});Object.defineProperty(HTMLElement.prototype,'hidePopover',{value:undefined,configurable:true});const matches=Element.prototype.matches;Element.prototype.matches=function(selector){if(selector.includes(':popover-open'))throw new DOMException('unsupported selector','SyntaxError');return matches.call(this,selector);};window.pickerErrors=[];window.addEventListener('error',e=>window.pickerErrors.push(e.message));");
}
try {
  for (const [width, height] of [[2000, 1100], [1280, 577], [1000, 320], [390, 844]] as const) {
    browser("set", "viewport", String(width), String(height));
    browser("open", url);
    browser("wait", ".workbench");
    openChat();
    removePopoverSupport();
    menu(); choose("Model…");
    browser("wait", ".provider-picker");
    check(`${width}x${height}: fields and footer within viewport without Popover API`, `const p=document.querySelector('.provider-picker'),r=p.getBoundingClientRect(),f=p.querySelector('.provider-actions').getBoundingClientRect();if(!document.querySelector('.workbench')||window.pickerErrors.length||p.parentElement!==document.body)throw Error('portal/app failed');if(r.top<11||r.left<11||r.bottom>innerHeight-11||r.right>innerWidth-11||f.bottom>innerHeight-11)throw Error(JSON.stringify({r:r.toJSON(),f:f.toJSON()}));if(!p.contains(document.activeElement))throw Error('picker focus missing');`);
    rectangles.push(browser("eval", `JSON.stringify({viewport:[innerWidth,innerHeight],picker:document.querySelector('.provider-picker').getBoundingClientRect().toJSON(),body:document.querySelector('.provider-picker-content').getBoundingClientRect().toJSON(),scrollHeight:document.querySelector('.provider-picker-content').scrollHeight,footer:document.querySelector('.provider-actions').getBoundingClientRect().toJSON()})`));
    if (width === 1280) {
      browser("eval", "const anchor=document.querySelector('.chat .bar-more');window.anchorStyle=anchor.style.cssText;anchor.style.position='fixed';anchor.style.top='12px';anchor.style.left='12px';window.dispatchEvent(new Event('resize'));");
      check("controlled top-edge anchor opens below without clipping", "const p=document.querySelector('.provider-picker').getBoundingClientRect(),a=document.querySelector('.chat .bar-more').getBoundingClientRect();if(p.top<a.bottom||p.bottom>innerHeight-11||p.left<11)throw Error(JSON.stringify({p:p.toJSON(),a:a.toJSON()}));");
      browser("eval", "document.querySelector('.chat .bar-more').style.cssText=window.anchorStyle;window.dispatchEvent(new Event('resize'));");
      check("restored bottom anchor stays in viewport", "const r=document.querySelector('.provider-picker').getBoundingClientRect();if(r.top<11||r.bottom>innerHeight-11)throw Error('restored anchor clipped');");
    }
    browser("fill", ".provider-model input", "synthetic-viewport-model");
    check("keyboard scroll reaches model", "const r=document.querySelector('.provider-model input').getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)throw Error('model inaccessible');");
    browser("press", "Tab");
    check("keyboard reaches Cancel", "if(document.activeElement?.textContent!=='Cancel')throw Error('Cancel not in keyboard path');");
    browser("press", "Tab");
    check("keyboard reaches Save", "if(document.activeElement?.textContent!=='Use for new conversations')throw Error('Save not in keyboard path');");
    browser("screenshot", `${evidence}/${width}-${height}.png`);
    writeFileSync(`${evidence}/${width}-${height}.ax.txt`, browser("snapshot", "-i", "-s", ".provider-picker"));
    if (width === 1000) {
      browser("set", "viewport", "960", "260");
      check("open picker follows resize", "const r=document.querySelector('.provider-picker').getBoundingClientRect();if(r.top<11||r.bottom>249||r.right>949)throw Error(JSON.stringify(r.toJSON()));");
      browser("screenshot", `${evidence}/resized-960-260.png`);
    }
    browser("press", "Escape");
    check("Escape closes only picker and restores More focus", "if(document.querySelector('.provider-picker')||document.activeElement!==document.querySelector('.chat .bar-more')||!document.querySelector('.chat textarea')?.checkVisibility())throw Error('Escape/focus failed');");
    menu(); choose("Model…");
    browser("find", "role", "button", "click", "--name", "Cancel", "--exact");
    check("pointer Cancel restores trigger", "if(document.querySelector('.provider-picker')||document.activeElement!==document.querySelector('.chat .bar-more'))throw Error('Cancel failed');");
    menu(); choose("Model…");
    browser("fill", ".provider-model input", "synthetic-viewport-model");
    browser("find", "role", "button", "click", "--name", "Use for new conversations");
    browser("wait", "--fn", "!document.querySelector('.provider-picker')");
    menu(); choose("Model…");
    browser("mouse", "move", "4", "4");
    browser("mouse", "down");
    browser("mouse", "up");
    browser("wait", "--fn", "!document.querySelector('.provider-picker')");
    openChat();
  }
  browser("open", url);
  browser("wait", ".workbench");
  check("panel fixture ready", "");
  removePopoverSupport();
  const fixture = await Bun.build({ entrypoints: [new URL("./provider-picker-panel.fixture.tsx", import.meta.url).pathname], target: "browser", format: "esm" });
  if (!fixture.success || !fixture.outputs[0]) throw new Error("panel fixture bundle failed");
  const code = await fixture.outputs[0].text();
  const injected = Bun.spawnSync(["agent-browser", "--session", session, "eval", "--stdin"], { stdin: Buffer.from(`import(URL.createObjectURL(new Blob([${JSON.stringify(code)}],{type:'text/javascript'})))`), stdout: "pipe", stderr: "pipe" });
  if (injected.exitCode !== 0) throw new Error(injected.stderr.toString());
  browser("wait", ".provider-change");
  browser("click", ".provider-change");
  browser("wait", ".provider-picker");
  check("non-menu picker escapes clipped transformed parent without Popover API", "const p=document.querySelector('.provider-picker'),r=p.getBoundingClientRect();if(p.parentElement!==document.body||r.top<11||r.bottom>innerHeight-11||window.pickerErrors.length)throw Error('panel picker clipped/crashed');");
  browser("press", "Escape");
  check("non-menu Escape returns Change focus", "if(document.querySelector('.provider-picker')||document.activeElement!==document.querySelector('.provider-change'))throw Error('panel focus failed');");
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    browser("set", "viewport", String(width), String(height));
    browser("open", url);
    browser("wait", ".workbench");
    selectBoard("Moonlander", width === 390);
    openChat();
    menu();
    check("idle New is available", "if([...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('New conversation'))?.disabled)throw Error('idle New disabled');");
    choose("New conversation");
    browser("fill", ".chat textarea", `Synthetic earlier ${width}`);
    browser("press", "Enter");
    browser("wait", "--fn", "document.querySelector('.chat')?.dataset.streaming==='false' && !!document.querySelector('.msg-assistant .prose')");
    selectBoard("Glove80", width === 390);
    browser("wait", ".carried-thread");
    browser("fill", ".chat textarea", `Unsent retained ${width}`);
    check("saved history baseline", "window.countBeforeFresh=(await(await fetch('/api/layouts/glove-daily/conversations',{headers:{'x-keyloom-token':'dev-editor-token'}})).json()).conversations.length;");
    menu();
    check("carried thread New is available", "if([...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('New conversation'))?.disabled)throw Error('carried New disabled');");
    choose("New conversation");
    check("fresh composer clears carry and preserves unsent text", `if(document.querySelector('.carried-thread')||document.querySelector('.chat textarea').value!==${JSON.stringify(`Unsent retained ${width}`)}||document.activeElement!==document.querySelector('.chat textarea'))throw Error('fresh composer failed');`);
    check("opening fresh creates no conversation and next POST has no old ID", `const headers={'x-keyloom-token':'dev-editor-token'};const before=await(await fetch('/api/layouts/glove-daily/conversations',{headers})).json();window.beforeNewCount=before.conversations.length;if(window.beforeNewCount!==window.countBeforeFresh)throw Error('phantom empty conversation');const original=window.fetch;window.fetch=async(input,init)=>{if(String(input).endsWith('/chat')&&init?.method==='POST')window.freshChatInput=JSON.parse(init.body);return original(input,init);};`);
    browser("press", "Enter");
    browser("wait", "--fn", "document.querySelector('.chat')?.dataset.streaming==='false' && !!document.querySelector('.msg-assistant .prose')");
    check("new message creates new history without appending old thread", "if(window.freshChatInput?.conversationId!==undefined)throw Error('old conversation reused');const headers={'x-keyloom-token':'dev-editor-token'};const next=await(await fetch('/api/layouts/glove-daily/conversations',{headers})).json();const old=await(await fetch('/api/layouts/moonlander-daily/conversations',{headers})).json();if(next.conversations.length!==window.beforeNewCount+1||!old.conversations.length)throw Error('history lost/not new');");
    browser("screenshot", `${evidence}/fresh-conversation-${width}.png`);
    check("install deterministic busy barrier", "const original=window.fetch;window.fetch=async(input,init)=>{if(String(input).endsWith('/chat')&&init?.method==='POST')await new Promise(resolve=>window.releaseChat=resolve);return original(input,init);};");
    browser("fill", ".chat textarea", "Busy guard synthetic request");
    browser("press", "Enter");
    browser("wait", "--fn", "typeof window.releaseChat==='function'");
    menu();
    check("active reply keeps New disabled and Stop available", "if(![...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('New conversation'))?.disabled||!document.querySelector('.composer-stop'))throw Error('busy guard lost');");
    browser("press", "Escape");
    browser("click", ".composer-stop");
    browser("eval", "window.releaseChat()");
  }
  writeFileSync(`${evidence}/rectangles.json`, `[${rectangles.map((line) => JSON.parse(line)).join(",")}]`);
} finally { browser("close"); }
