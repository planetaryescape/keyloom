// Start independent fixtures first (manual: 40 boards; first: 0 manual; controller: 0 usb).
// bun test/web/collection-onboarding.browser.ts <manual|first|controller> <port> [evidence-directory]
import { mkdirSync } from "node:fs";
export {};

const mode = process.argv[2];
if (!mode || !["manual", "first", "controller"].includes(mode)) throw new Error("Choose manual, first or controller");
const port = Number(process.argv[3]);
if (!Number.isInteger(port) || port < 1) throw new Error("Supply the fixture port");
const evidence = process.argv[4];
if (evidence) mkdirSync(evidence, { recursive: true });
const session = Bun.spawnSync(["agent-browser", "session", "id", "--scope", "worktree", "--prefix", `onboarding-${mode}`]).stdout.toString().trim();
function browser(...args: string[]): string {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args.join(" ")} failed: ${result.stdout}${result.stderr}`);
  return result.stdout.toString();
}
const click = (role: string, name: string) => {
  browser("wait", "--fn", "document.getAnimations().every(a=>a.playState!=='running')");
  return browser("find", "role", role, "click", "--name", name, "--exact");
};
const check = (expression: string, message: string) => browser("eval", `if(!(${expression}))throw Error(${JSON.stringify(message)})`);
const shot = (name: string) => { if (evidence) browser("screenshot", `${evidence}/${mode}-${name}.png`); };
try {
  browser("set", "viewport", "1440", "900");
  browser("set", "media", "light", "reduced-motion");
  browser("open", `http://127.0.0.1:${port}/?t=collection-browser-token`);
  browser("wait", "--load", "networkidle");
  if (mode === "manual") {
    browser("wait", "button[aria-label='Open Keyboard 40']");
    browser("wait", "--fn", "document.getAnimations().every(a=>a.playState!=='running')");
    browser("focus", "button[aria-label='Open Keyboard 40']"); browser("press", "Enter");
    browser("wait", "button[aria-label='Choose a config']");
    browser("wait", "--fn", "document.getAnimations().every(a=>a.playState!=='running')");
    click("button", "Choose a board");
    browser("network", "route", "**/api/keyboards/collection", "--abort");
    click("menuitem", "Add a keyboard…");
    browser("wait", "--text", "Couldn't check your keyboard collection.");
    check("document.querySelectorAll('.onboarding-catalogue > button').length===0", "Catalogue offered setup without checking removed membership");
    check("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Not listed? Search QMK and ZMK'))?.disabled", "Firmware search stayed enabled without checked membership");
    check("document.querySelectorAll('.onboarding-choices > .nb-list button').length===0", "Firmware search advertised unchecked candidates");
    browser("network", "unroute", "**/api/keyboards/collection"); click("button", "Try again");
    browser("wait", "--load", "networkidle");
    browser("fill", "input[aria-label='Find a keyboard to add']", "corne");
    browser("wait", "--load", "networkidle");
    browser("click", ".onboarding-catalogue button");
    // The removed board must never enter the fresh-config wizard.
    browser("wait", "dialog.keyboard-collection[open]");
    browser("wait", "--load", "networkidle");
    check("[...document.querySelectorAll('.collection-tabs button')].some(b=>b.textContent.includes('Removed')&&b.getAttribute('aria-pressed')==='true')", "Removed catalogue entry did not open the Removed collection");
    click("button", "Restore Corne");
    browser("wait", "--text", "Corne restored."); shot("restored");
    browser("fill", "input[aria-label='Find in your keyboards']", "corne");
    click("button", "Open");
    browser("wait", "button[aria-label='Choose a config']");
    check("document.querySelector('[aria-label=\"Choose a board\"]')?.textContent.includes('Corne')", "Restore did not open the retained config");
    check("document.querySelector('[aria-label=\"Choose a config\"]')?.textContent.includes('Archived synthetic Corne')", "Restore did not retain and open the archived config");
    console.log("PASS removed catalogue choice opens Restore; restore keeps the old config and opens it");
  } else if (mode === "first") {
    browser("wait", ".keyboard-welcome");
    browser("fill", "input[aria-label='Find a keyboard to add']", "macbook");
    click("button", "MacBook keyboard (ANSI) Apple"); click("button", "Start blank");
    browser("wait", "--load", "networkidle");
    check("!!document.querySelector('[aria-label=\"Choose a config\"]')&&!document.querySelector('.pegboard')", "First config returned to Home rather than opening the editor");
    shot("editor");
    console.log("PASS first manual config opens directly in the editor");
  } else {
    browser("wait", ".keyboard-welcome"); click("button", "It's a Corne");
    browser("wait", ".onboarding-panel");
    click("radio", "nice!nano"); browser("press", "ArrowDown");
    check("document.activeElement?.closest('label')?.textContent.includes('SparkFun Pro Micro RP2040')&&document.activeElement.matches(':checked')", "ArrowDown did not select and focus the next controller");
    browser("press", "ArrowUp");
    check("document.activeElement?.closest('label')?.textContent.includes('nice!nano')&&document.activeElement.matches(':checked')", "ArrowUp did not return to nice!nano");
    browser("press", "Tab");
    check("!document.activeElement?.closest('fieldset')?.textContent.includes('SparkFun')", "Tab did not leave the controller radio group");
    click("radio", "Top row"); browser("press", "ArrowRight");
    check("document.activeElement?.closest('label')?.textContent.includes('Middle row')&&document.activeElement.matches(':checked')", "Home-row radios do not support arrow navigation");
    browser("wait", "--load", "networkidle"); shot("keyboard-confirmation");
    check("[...document.querySelectorAll('.nb-step > fieldset')].every(group=>parseFloat(getComputedStyle(group).marginTop)>0)&&[...document.querySelectorAll('.nb-step .choice')].every(choice=>parseFloat(getComputedStyle(choice).fontSize)===12)", "Onboarding choices lost compact spacing or type sizing");
    browser("set", "viewport", "390", "844");
    for (const theme of ["light", "dark"]) {
      browser("eval", `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      browser("scrollintoview", ".onboarding-panel fieldset:last-of-type");
      shot(`confirmation-390-${theme}`);
      check("document.scrollingElement.scrollWidth<=innerWidth+1", "Confirmation overflows the mobile viewport");
    }
    click("button", "Show me the board"); click("button", "Add the Corne (new)");
    browser("wait", "--text", "Start a config"); click("button", "Start a config");
    browser("wait", "--load", "networkidle");
    check("!!document.querySelector('[aria-label=\"Choose a config\"]')&&!document.querySelector('.pegboard')", "First USB config returned to Home rather than opening the editor");
    shot("editor");
    console.log("PASS native controller/home-row arrows, single tab stop, and first USB config opens directly");
  }
  browser("wait", "--fn", "document.getAnimations().every(a=>a.playState!=='running')");
  for (const theme of ["light", "dark"]) for (const [width, height] of [[1440, 900], [390, 844]]) {
    browser("set", "viewport", String(width), String(height));
    browser("eval", `document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    check("document.scrollingElement.scrollWidth<=innerWidth+1", "Page overflows the viewport");
    shot(`${width}-${theme}`);
  }
} catch (error) {
  shot("failure");
  console.error(browser("snapshot", "-i", "-d", "2"));
  throw error;
} finally { browser("close"); }
