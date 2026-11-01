// Terminal 1: bun test/web/chat-scroll-server.ts
// Terminal 2: bun test/web/chat-scroll.browser.ts [screenshot-directory]
// Exercises real streamed replies, proposals and screen-reader text in App/Viewer.
import { mkdirSync } from "node:fs";
export {};

const session = "keyloom-chat-scroll-regression";
const evidence = process.argv[2];
if (evidence) mkdirSync(evidence, { recursive: true });

function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args[0]} failed: ${result.stdout}${result.stderr}`);
  return result.stdout.toString();
}

function check(name: string, body: string): void {
  browser("eval", `(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);${body}})()`);
  console.log(`PASS ${name}`);
}

try {
  // Establish the fixture origin so each case can clear its saved thread before navigation.
  browser("open", "http://127.0.0.1:4517/?t=dev-editor-token");
  for (const [width, height] of [[1440, 900], [1100, 577], [390, 844]] as const) {
    for (const theme of ["light", "dark"]) {
      browser("set", "viewport", String(width), String(height));
      browser("eval", "localStorage.removeItem('keyloom.agent.current.moonlander-daily')");
      browser("open", "http://127.0.0.1:4517/?t=dev-editor-token");
      browser("wait", ".workbench");
      check(`${width} ${theme}: editor ready`, "");
      browser("eval", `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      browser("eval", "if(document.querySelector('.topbar-ask').getAttribute('aria-pressed')!=='true')document.querySelector('.topbar-ask').click()");
      browser("wait", "--fn", "document.querySelector('.chat textarea')?.checkVisibility()");
      check(`${width} ${theme}: composer ready`, "");
      browser("fill", ".chat textarea", "Please make it easier for me to press Option twice.");
      check(`${width} ${theme}: message ready`, "if(!document.querySelector('.chat textarea').value) throw Error('message missing');");
      browser("press", "Enter");
      browser("wait", "--fn", "document.querySelector('.chat')?.dataset.streaming==='false' && !!document.querySelector('.chat-log .sr-only')");
      check(`${width} ${theme}: long reply stays inside the viewport`, `
        const log=document.querySelector('.chat-log'), page=document.scrollingElement;
        if(log.querySelectorAll('.msg-assistant').length!==1) throw Error('case reused a previous conversation');
        if(!log.textContent.includes('Paragraph 30:') || log.scrollHeight<log.clientHeight*3) throw Error('long reply fixture missing');
        window.scrollTo(0,page.scrollHeight);
        const board=document.querySelector('.keyboard').getBoundingClientRect(), input=document.querySelector('.chat textarea').getBoundingClientRect();
        if(page.scrollHeight>innerHeight+1 || scrollY!==0 || board.bottom<=0 || board.top>=innerHeight || input.bottom>innerHeight) throw Error(JSON.stringify({page:page.scrollHeight,scrollY,board:board.toJSON(),input:input.toJSON()}));
        window.boardBeforeChatScroll=board.toJSON();
      `);
      for (const end of ["top", "bottom"]) {
        browser("eval", `document.querySelector('.chat-log').scrollTop=${end === "top" ? "0" : "document.querySelector('.chat-log').scrollHeight"}`);
        check(`${width} ${theme}: scrolling to ${end} keeps the keyboard in place`, `
          const log=document.querySelector('.chat-log'), board=document.querySelector('.keyboard').getBoundingClientRect();
          if(${end === "top" ? "log.scrollTop!==0" : "log.scrollTop<=0 || Math.abs(log.scrollHeight-log.clientHeight-log.scrollTop)>1"}) throw Error('conversation did not scroll');
          if(scrollY!==0 || document.scrollingElement.scrollHeight>innerHeight+1 || Math.abs(board.top-window.boardBeforeChatScroll.top)>1) throw Error('chat scrolling moved the page or keyboard');
        `);
      }
      // Keyboard scrolling must also stay in the conversation rather than move the page.
      browser("eval", "const log=document.querySelector('.chat-log');log.scrollTop=0;log.focus()");
      browser("press", "PageDown");
      check(`${width} ${theme}: keyboard scrolls the conversation, not the page`, "if(document.querySelector('.chat-log').scrollTop<=0) throw Error('keyboard did not scroll the conversation');if(scrollY!==0 || document.scrollingElement.scrollHeight>innerHeight+1) throw Error('keyboard scrolled the page');");
      if (evidence) browser("screenshot", `${evidence}/${width}-${height}-${theme}.png`);
    }
  }
} catch (error) {
  console.error(browser("eval", "JSON.stringify({pageHeight:document.scrollingElement.scrollHeight,scrollY,streaming:document.querySelector('.chat')?.dataset.streaming,replyLength:document.querySelector('.chat-log')?.textContent.length})"));
  throw error;
} finally {
  browser("close");
}
