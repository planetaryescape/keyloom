// Start unmodelled-board-server.ts once for split and once for compact, then:
// bun test/web/unmodelled-board.browser.ts <split-url> <compact-url> [screenshot-directory]
import { mkdirSync } from "node:fs";

const session = "keyloom-unmodelled-board";
const [splitUrl, compactUrl, evidence] = process.argv.slice(2);
if (!splitUrl || !compactUrl) throw new Error("Pass the split and compact fixture URLs");
if (evidence) mkdirSync(evidence, { recursive: true });
function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args[0]} failed: ${result.stdout}${result.stderr}`);
  return result.stdout.toString();
}

try {
  for (const [keyboard, url] of [["split", splitUrl], ["compact", compactUrl]] as const) {
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      for (const theme of ["light", "dark"]) {
        browser("set", "viewport", String(width), String(height));
        browser("open", url);
        // The app opens on the pegboard home wall (D-478); the checks run in the editor it opens.
        // Clicks land on the transition overlay until the wall's entry animation ends.
        browser("wait", "--fn", "(()=>{const b=document.querySelector('button.peg-board'); if(!b) return false; const r=b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()");
        browser("click", "button.peg-board");
        browser("wait", "--fn", "!document.querySelector('.pegboard') && !!document.querySelector('.stage .keyboard .cap')");
        browser("eval", `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        browser("eval", `(async()=>{
          await document.fonts.ready; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
          const board=document.querySelector('.keyboard'), caps=[...board.querySelectorAll('.cap')];
          const expected=${keyboard === "split" && width === 390 ? 21 : 42};
          if(caps.length!==expected || board.querySelectorAll('.cap-top').length!==expected || board.querySelectorAll('.cap-body').length!==expected) throw Error('missing sculpted keys');
          if(board.querySelectorAll('.case-edge').length!==${keyboard === "split" && width !== 390 ? 2 : 1}) throw Error('wrong case topology');
          const body=board.querySelector('.case-body'), fill=getComputedStyle(body).fill;
          if(!fill.includes('url(') || !board.querySelector('.case-top-hi')) throw Error('missing case shading');
          const box=board.getBoundingClientRect(), scrolls=${keyboard === "compact" && width === 390};
          if(box.left<0 || (!scrolls && box.right>innerWidth+1) || box.top<0 || box.bottom>innerHeight+1) throw Error('board outside stage: '+JSON.stringify(box));
          if(document.scrollingElement.scrollWidth>innerWidth+1) throw Error('horizontal page overflow');
          if(scrolls) {
            const well=board.closest('.keyboard-well');
            if(well.dataset.overflowing!=='true' || well.scrollWidth<=well.clientWidth) throw Error('wide one-piece board must scroll inside its stage');
            well.scrollLeft=well.scrollWidth;
            if(caps.at(-1).getBoundingClientRect().right>innerWidth+1 || !well.scrollLeft) throw Error('last key is unreachable');
            well.scrollLeft=0;
          } else for(const cap of caps) {const box=cap.getBoundingClientRect(); if(box.left<0 || box.right>innerWidth+1 || box.bottom>innerHeight+1) throw Error('key outside stage');}
          window.unmodelledGeometry=caps.map(cap=>[cap.dataset.keyIndex,cap.style.left,cap.style.top,cap.style.width,cap.style.height,cap.style.transform]);
        })()`);
        if (evidence) browser("screenshot", `${evidence}/${keyboard}-${width}-${height}-${theme}.png`);
        // Arrow navigation and opening/closing the editor still work on the inferred enclosure.
        browser("focus", '.keyboard .cap[tabindex="0"]');
        browser("press", "ArrowRight");
        browser("eval", "if(!document.activeElement?.matches('.cap') || document.activeElement.dataset.keyIndex===window.unmodelledGeometry[0][0]) throw Error('arrow navigation failed')");
        browser("press", "Enter");
        browser("wait", ".key-card");
        browser("press", "Escape");
        browser("wait", "--fn", "!document.querySelector('.key-card')");
        console.log(`PASS ${keyboard} ${width}×${height} ${theme}: dimensional case/caps, fit, keyboard navigation and editor`);
      }
    }
  }
} finally {
  browser("close");
}
