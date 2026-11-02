// Terminal 1: bun test/web/review-overflow-server.ts
// Terminal 2: bun test/web/review-overflow.browser.ts [screenshot-directory]
import { mkdirSync } from "node:fs";
export {};

const session = Bun.spawnSync(["agent-browser", "session", "id", "--scope", "worktree", "--prefix", "review-overflow"]).stdout.toString().trim();
const evidence = process.argv[2];
if (evidence) mkdirSync(evidence, { recursive: true });
function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args[0]} failed: ${result.stdout}${result.stderr}`);
  return result.stdout.toString();
}
const url = "http://127.0.0.1:4518/?t=dev-editor-token";
try {
  for (const [width, height] of [[1440, 900], [1100, 577], [390, 844]] as const) for (const theme of ["light", "dark"]) {
    browser("set", "viewport", String(width), String(height));
    browser("open", url);
    browser("wait", ".br-marker");
    browser("eval", `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.br-marker').click()`);
    browser("wait", ".br-panel");
    browser("eval", `(async()=>{
      await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const page=document.scrollingElement,panel=document.querySelector('.br-panel'),body=panel.querySelector('.br-body');
      const close=panel.querySelector('.sheet-close'),board=document.querySelector('.keyboard');
      const rect=panel.getBoundingClientRect(),control=close.getBoundingClientRect();
      const overflow={viewport:innerWidth,panel:rect.toJSON(),close:control.toJSON(),bodyClient:body.clientWidth,bodyScroll:body.scrollWidth,pageClient:page.clientWidth,pageScroll:page.scrollWidth};
      if(!body.textContent.includes('hold-trigger-key-positions') || body.querySelectorAll('.br-item').length!==8) throw Error('long review fixture missing');
      if(rect.right>innerWidth+1 || rect.left<0 || control.right>innerWidth || control.left<rect.left || body.scrollWidth>body.clientWidth+1 || page.scrollWidth>page.clientWidth+1) throw Error('Review text or controls extend past sidebar: '+JSON.stringify(overflow));
      const walker=document.createTreeWalker(panel,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        const range=document.createRange();range.selectNodeContents(walker.currentNode);
        for(const line of range.getClientRects()) if(line.width>0 && (line.right>rect.right+1 || line.left<rect.left-1)) throw Error('Text extends outside the panel even if overflow is hidden');
      }
      const foot=panel.querySelector('.br-foot').getBoundingClientRect();
      if(foot.right>rect.right+1 || foot.bottom>innerHeight+1) throw Error('Footer controls are clipped');
      const before=board.getBoundingClientRect().top;
      if(body.scrollHeight<=body.clientHeight) throw Error('fixture does not exercise vertical scrolling');
      body.scrollTop=body.scrollHeight;
      await new Promise(requestAnimationFrame);
      if(body.scrollTop<=0 || Math.abs(body.scrollHeight-body.clientHeight-body.scrollTop)>1 || Math.abs(board.getBoundingClientRect().top-before)>1) throw Error('review scroll moved the keyboard or hid the bottom');
    })()`);
    console.log(`PASS ${width}×${height} ${theme}: review text, controls and scrolling stay inside the sidebar`);
    if (evidence) { browser("eval", "document.querySelector('.br-body').scrollTop=0"); browser("screenshot", `${evidence}/${width}-${height}-${theme}.png`); }
  }
} finally { browser("close"); }
