// Real Viewer regression, not a static-markup or helper test. No added DOM dependency.
// Terminal 1: KEYLOOM_FAKE_TOKEN_MS=80 bun scripts/dev-editor.ts 4508
// Terminal 2: bun test/web/chat-focus.browser.ts
// Only run against an isolated synthetic dev-editor. Never point this at real user data.
export {};

const url = process.argv[2] ?? "http://127.0.0.1:4508/?t=dev-editor-token";
const session = "keyloom-chat-focus-regression";
const origin = new URL(url);
if (origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost") throw new Error("Use a loopback synthetic dev-editor.");
if (origin.searchParams.get("t") !== "dev-editor-token") throw new Error("Use the synthetic dev-editor token, never a real server.");

function browser(...args: string[]): void {
  const result = Bun.spawnSync(["agent-browser", "--session", session, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args[0]} failed: ${result.stdout.toString()}${result.stderr.toString()}`);
}

function check(name: string, condition: string): void {
  browser("eval", `(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const input = document.querySelector('.chat textarea');
    if (!(${condition})) throw new Error(${JSON.stringify(name)} + ': ' + JSON.stringify({visible: input?.checkVisibility(), focused: document.activeElement === input, activeTag: document.activeElement?.tagName, draft: input?.value}));
    return true;
  })()`);
  console.log(`PASS ${name}`);
}

try {
  for (const [width, height] of [[1440, 900], [1100, 700], [390, 844]] as const) {
    browser("set", "viewport", String(width), String(height));
    browser("open", url);
    browser("wait", ".topbar-ask");
    browser("press", "Meta+k");
    check(`${width}: keyboard open focuses visible composer`, "input?.checkVisibility() && document.activeElement === input");
    browser("press", "k");
    check(`${width}: immediate typing reaches composer`, "input?.value === 'k'");
    browser("press", "Meta+k");
    check(`${width}: closed chat is not focused`, "!input?.checkVisibility() && document.activeElement !== input");
    browser("press", "Meta+k");
    check(`${width}: reopen focuses retained draft`, "input?.checkVisibility() && document.activeElement === input && input.value === 'k'");
    browser("press", "l");
    check(`${width}: reopen accepts typing without pointer`, "input?.value === 'kl'");
    browser("press", "Meta+k");
    browser("click", ".topbar-ask");
    check(`${width}: Ask click focuses retained draft`, "input?.checkVisibility() && document.activeElement === input && input.value === 'kl'");
    browser("eval", "document.querySelector('.topbar-ask').focus()");
    browser("set", "viewport", String(width - 4), String(height));
    check(`${width}: ordinary viewport rerender does not steal focus`, "document.activeElement === document.querySelector('.topbar-ask')");

    // Wait on real scripted text updates, never retry a focus assertion until it passes.
    browser("press", "Meta+k");
    browser("press", "Meta+k");
    browser("keyboard", "type", " Give me an Option key.");
    browser("press", "Enter");
    browser("wait", ".composer-stop");
    browser("eval", "document.querySelector('.topbar-ask').focus(); window.focusTextBefore = document.querySelector('.msg-assistant .prose')?.textContent ?? ''");
    browser("wait", "--fn", "(document.querySelector('.msg-assistant .prose')?.textContent ?? '') !== window.focusTextBefore");
    check(`${width}: streaming updates do not steal focus`, "document.activeElement === document.querySelector('.topbar-ask')");
    browser("press", "Meta+k");
    browser("eval", "document.body.tabIndex = -1; document.body.focus()");
    browser("click", ".chat-background-work .composer-stop");
    check(`${width}: finishing a stopped stream cannot focus closed composer`, "!input?.checkVisibility() && document.activeElement !== input");
  }
} finally {
  browser("close");
}
