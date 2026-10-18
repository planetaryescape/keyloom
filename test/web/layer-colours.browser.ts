// Only against the owned in-memory server from layer-colours-dev.ts on port 4508.
// bun test/web/layer-colours.browser.ts leds|display-only
export {};

const hardware = process.argv[2] === "leds";
if (!hardware && process.argv[2] !== "display-only") throw new Error("Specify leds or display-only for the synthetic board.");
const session = "keyloom-layer-colours-review";
function browser(...args: string[]): void {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args[0]} failed: ${result.stdout.toString()}${result.stderr.toString()}`);
}
const read = "(await (await fetch('/api/layouts/moonlander-daily', {headers:{'x-keyloom-token':'dev-editor-token'}})).json())";
function check(name: string, expression: string): void {
  browser("eval", `(async () => { if (!(${expression})) throw Error(${JSON.stringify(name)}); return true; })()`);
  console.log(`PASS ${name}`);
}

try {
  let colour = 0;
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    browser("set", "viewport", String(width), String(height));
    for (const theme of ["light", "dark"]) {
      colour++;
      browser("open", "http://127.0.0.1:4508/?t=dev-editor-token");
      browser("wait", ".layer-menu");
      browser("eval", `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      browser("eval", `(async () => { window.colourBefore = ${read}; })()`);
      browser("focus", ".layer-menu > button");
      browser("press", "Enter");
      browser("find", "text", "On-screen label and colour", "click", "--exact");
      check(`${width}/${theme}: real display form explains scope and offers six palette choices`, "document.querySelector('.layer-look').textContent.includes('not keyboard LEDs') && document.querySelectorAll('.layer-look input[type=radio]').length === 6");
      browser("check", `.layer-look input[aria-label="Colour ${colour}"]`);
      browser("click", ".layer-look button[type=submit]");
      check(`${width}/${theme}: display save preserves short label and LED configuration`, `(await (async () => { const after = ${read}; const a = after.document.layers[0]; const b = window.colourBefore.document.layers[0]; return a.color === ${colour} && a.shortLabel === 'KEEP' && a.shortLabel === b.shortLabel && JSON.stringify(a.lighting) === JSON.stringify(b.lighting); })())`);

      browser("find", "role", "button", "click", "--name", "More", "--exact");
      browser("find", "role", "menuitem", "click", "--name", "Settings", "--exact");
      browser("wait", ".settings-pane");
      check(`${width}/${theme}: Settings names physical LED scope separately`, "document.querySelector('.settings-pane').textContent.includes('Keyboard LED lighting') && document.querySelector('.settings-pane').textContent.includes('Physical keyboard lights, separate from')");
      if (!hardware) {
        check(`${width}/${theme}: unsupported board explains the limit and offers no LED picker`, "document.querySelector('.settings-pane').textContent.includes('LED editing is unavailable:') && document.querySelector('.settings-pane').textContent.includes('On-screen layer colours are still available') && document.querySelector('.settings-pane .colour-choice') === null");
      } else {
        browser("click", ".layer-colour > summary");
        browser("eval", `(async () => { window.colourBefore = ${read}; })()`);
        browser("click", `[role="group"][aria-label="LED colour for Base"] button[aria-label="${theme === "light" ? "Blue" : "Red"}"]`);
        browser("wait", "--fn", "document.querySelector('.settings-foot .bar-apply')?.disabled === false");
        browser("click", ".settings-foot .bar-apply");
        check(`${width}/${theme}: LED save preserves on-screen style and per-key LEDs`, `(await (async () => { const after = ${read}; const a = after.document.layers[0]; const b = window.colourBefore.document.layers[0]; return a.color === b.color && a.shortLabel === b.shortLabel && JSON.stringify(a.lighting?.layer) !== JSON.stringify(b.lighting?.layer) && JSON.stringify(a.lighting?.keys) === JSON.stringify(b.lighting?.keys); })())`);
      }
    }
  }
} finally { browser("close"); }
