// Tight real-browser resize regression. Only use an isolated synthetic server.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const session = "keyloom-model-picker-viewport";
const evidence = process.argv[2] ?? "/private/var/folders/3p/n76j7jp14ljcvr1bhf7qmlh00000gn/T/opencode/model-picker-resize";
const url = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")).url : "http://127.0.0.1:4512/?t=dev-editor-token";
if (!String(url).startsWith("http://127.0.0.1:4512/")) throw new Error("Only the owned synthetic port is permitted");
mkdirSync(evidence, { recursive: true });
function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args[0]}: ${result.stdout}${result.stderr}`);
  return result.stdout.toString();
}
function settle(): void { browser("eval", "(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})()"); }
try {
  for (const theme of ["light", "dark"]) {
    browser("set", "viewport", "1440", "900");
    browser("open", url);
    browser("wait", ".workbench"); settle(); browser("wait", ".topbar-ask");
    browser("eval", `const toggle=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(`Use the ${theme} theme`)});toggle?.click();if(document.querySelector('.topbar-ask').getAttribute('aria-pressed')!=='true')document.querySelector('.topbar-ask').click();`);
    browser("wait", "--fn", "document.querySelector('.chat textarea')?.checkVisibility()"); settle();
    // Match the compiled acceptance journey before leaving the final picker open.
    for (const action of ["save", "cancel", "escape"]) {
      browser("eval", "document.querySelector('.chat .bar-more').focus()"); browser("press", "Enter"); browser("wait", "[role=menuitem]"); browser("find", "role", "menuitem", "click", "--name", "Model…"); browser("wait", ".provider-picker"); settle();
      if (action === "escape") browser("press", "Escape");
      else { browser("fill", ".provider-model input", "synthetic-resize-model"); browser("find", "role", "button", "click", "--name", action === "save" ? "Use for new conversations" : "Cancel", "--exact"); }
      browser("wait", "--fn", "!document.querySelector('.provider-picker')");
    }
    browser("eval", "window.geometryTrace=[];const rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){const r=rect.call(this);if((this.classList.contains('bar-more')||this.classList.contains('provider-picker'))&&window.geometryTrace.length<512)window.geometryTrace.push({at:performance.now(),kind:this.className,viewport:[innerWidth,innerHeight],rect:r.toJSON()});return r;};document.querySelector('.chat .bar-more').focus();");
    browser("press", "Enter"); browser("wait", "[role=menuitem]"); browser("find", "role", "menuitem", "click", "--name", "Model…"); browser("wait", ".provider-picker"); settle();
    browser("eval", "window.styleObserver=new MutationObserver(()=>window.geometryTrace.push({at:performance.now(),kind:'final-style',style:document.querySelector('.provider-picker')?.getAttribute('style'),viewport:[innerWidth,innerHeight]}));window.styleObserver.observe(document.querySelector('.provider-picker'),{attributes:true,attributeFilter:['style']});");
    for (const [width, height] of [[1280, 577], [1440, 900], [1000, 320], [1280, 577]] as const) {
      browser("set", "viewport", String(width), String(height)); settle();
      const record = browser("eval", "JSON.stringify({viewport:[innerWidth,innerHeight],visual:visualViewport?{height:visualViewport.height,offsetTop:visualViewport.offsetTop}:null,form:document.querySelector('.provider-picker').getBoundingClientRect().toJSON(),footer:document.querySelector('.provider-actions').getBoundingClientRect().toJSON(),anchor:document.querySelector('.chat .bar-more').getBoundingClientRect().toJSON(),style:document.querySelector('.provider-picker').getAttribute('style'),trace:window.geometryTrace})");
      writeFileSync(`${evidence}/${theme}-${width}-${height}.json`, JSON.parse(record));
      browser("screenshot", `${evidence}/${theme}-${width}-${height}.png`);
      browser("eval", "{const p=document.querySelector('.provider-picker').getBoundingClientRect(),f=document.querySelector('.provider-actions').getBoundingClientRect();if(p.top<11||p.left<11||p.bottom>innerHeight-11||p.right>innerWidth-11||f.bottom>innerHeight-11)throw Error('resized picker/footer outside viewport');}");
      browser("eval", "{const input=document.querySelector('.provider-model input');if(input.value==='synthetic-resize-unsaved'&&document.activeElement!==input)throw Error('resize lost input focus');}");
      browser("scrollintoview", ".provider-model input");
      browser("fill", ".provider-model input", "synthetic-resize-unsaved");
      browser("eval", "{const input=document.querySelector('.provider-model input'),r=input.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight||document.activeElement!==input)throw Error('model focus/scroll lost');}");
      console.log(`PASS ${theme} ${width}x${height}`);
    }
    // Reproduce the exact recorded pre-layout anchor input, using a real DOM box rather than
    // mocking getBoundingClientRect. The viewport clamp must hold even before layout catches up.
    browser("eval", "{const a=document.querySelector('.chat .bar-more');window.resizeAnchorStyle=a.style.cssText;a.style.position='fixed';a.style.top='847px';window.dispatchEvent(new Event('resize'));}"); settle();
    const delayed = browser("eval", "JSON.stringify({viewport:[innerWidth,innerHeight],anchor:document.querySelector('.chat .bar-more').getBoundingClientRect().toJSON(),form:document.querySelector('.provider-picker').getBoundingClientRect().toJSON(),trace:window.geometryTrace})");
    writeFileSync(`${evidence}/${theme}-recorded-anchor-input.json`, JSON.parse(delayed));
    browser("eval", "{const r=document.querySelector('.provider-picker').getBoundingClientRect();if(r.top<11||r.bottom>innerHeight-11)throw Error('recorded offscreen anchor escaped viewport clamp');}");
    browser("eval", "document.querySelector('.chat .bar-more').style.cssText=window.resizeAnchorStyle;window.dispatchEvent(new Event('resize'));"); settle();
    browser("eval", "{const c=document.querySelector('.chat');window.beforeChatLayout=document.querySelector('.provider-picker').getBoundingClientRect().top;window.beforeChatStyle=c.style.cssText;c.style.height='220px';c.style.maxHeight='none';}"); settle();
    browser("eval", "{const r=document.querySelector('.provider-picker').getBoundingClientRect();if(Math.abs(r.top-window.beforeChatLayout)<1||r.top<11||r.bottom>innerHeight-11)throw Error('picker missed later chat layout movement');}");
    browser("eval", "document.querySelector('.chat').style.cssText=window.beforeChatStyle"); settle();
    browser("press", "Escape");
    browser("eval", "if(document.querySelector('.provider-picker')||document.activeElement!==document.querySelector('.chat .bar-more'))throw Error('Escape/focus failed');");
  }
} finally { browser("close"); }
