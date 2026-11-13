// The real board renderer and bundled font, with synthetic firmware names and no server API.
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Cap } from "../../src/web/keyboard/Cap.tsx";
import "../../src/web/fonts/fonts.css";
import "../../src/web/tokens.css";
import "../../src/web/keyboard/keyboard.css";

const names = ["KC_BACKSPACE", "TD(DANCE_0)", "st-macro-0", "OSM(MOD_LSFT)", "LCTL(KC_LEFT)", "MO(3)", "KC_TAB", "KC_SPACE", "W".repeat(200), "KC_GRAVE"];
let resize: ((wide: boolean) => void) | undefined;
function Fixture() {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => { resize = setWide; }, []);
  return <main style={{ padding: 24 }}>
    <h1>Board cap fit regression</h1>
    <p id="result" role="status">Checking rendered labels…</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      {names.map((name, index) => <div key={name} data-case={index}>
        <Cap tone="key" legend={index === 9 && !wide ? { tap: name, hold: "LT(1)" } : { tap: wide ? "A" : name }} compactTap={index === 8 ? "W".repeat(200) : "⌫"}
          breakable unit={wide ? 72 : 34} width={1} floorPx={10} title="Synthetic action" aria-label={`Source ${name}`}
          style={{ position: "relative", width: wide ? 68 : 32, height: wide ? 68 : 32 }} />
      </div>)}
    </div>
  </main>;
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
async function run() {
  const output = document.querySelector("#result")!;
  try {
    await document.fonts.ready;
    await frame();
    for (const [index, name] of names.entries()) {
      const cap = document.querySelector(`[data-case="${index}"] button`)!;
      const print = cap.querySelector<HTMLElement>(".cap-print")!;
      const text = print.querySelector<HTMLElement>(print.dataset.detail === "true" ? ".cap-detail" : ".cap-tap:not(.cap-compact-probe)")!;
      const face = print.querySelector(".cap-face")!.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(text);
      for (const line of range.getClientRects()) check(line.left >= face.left - 1 && line.right <= face.right + 1 && line.top >= face.top - 1 && line.bottom <= face.bottom + 1, `Case ${index}: print exceeds its face`);
      check(parseFloat(getComputedStyle(text).fontSize) >= 10, `Case ${index}: font below floor`);
      check(cap.getAttribute("title")?.includes(name) === true, `Case ${index}: source missing from tooltip`);
      check(cap.getAttribute("aria-description") === (index === 9 ? `${name} / LT(1)` : name), `Case ${index}: accessible source missing`);
      if (index === 9) check(print.dataset.detail === "true", "A tall tap overlaps the front row");
      if (index === 8) check(text.textContent === "…", "Unbounded plain label must disclose more detail");
    }
    const resizeOnly = document.querySelector<HTMLElement>('[data-case="0"] .cap')!;
    resizeOnly.style.width = "160px";
    resizeOnly.style.height = "160px";
    await frame();
    check(resizeOnly.querySelector(".cap-print")?.getAttribute("data-detail") === "false", "CSS-only growth keeps a stale fallback");
    resizeOnly.style.width = "32px";
    resizeOnly.style.height = "32px";
    await frame();
    check(resizeOnly.querySelector(".cap-print")?.getAttribute("data-detail") === "true", "CSS-only shrinking does not restore the fallback");
    resize?.(true); await frame();
    check(document.querySelectorAll('[data-detail="true"]').length === 0, "Short labels keep a stale fallback after resizing");
    resize?.(false); await frame();
    check(document.querySelectorAll('[data-detail="true"]').length > 0, "Long labels lose their fallback after resizing");
    output.textContent = "PASS: ten names, bounds, front overlap, accessible source and CSS-only resizing";
    document.body.dataset.result = "passed";
  } catch (error) {
    output.textContent = `FAIL: ${String(error)}`;
    document.body.dataset.result = "failed";
  }
}
createRoot(document.querySelector("#root")!).render(<Fixture />);
void frame().then(run);
