// Real key cards and loaded fonts. Synthetic labels only; no server API, model or keyboard.
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HeroCap } from "../../src/web/card/HeroCap.tsx";
import "../../src/web/fonts/fonts.css";
import "../../src/web/tokens.css";
import "../../src/web/app.css";
import "../../src/web/keyboard/keyboard.css";
import "../../src/web/card/card.css";

const longName = `tap-dance td_${"long_identifier_".repeat(12)}`;
const cases: { text: string; size: number; corners: boolean; compactTap?: string }[] = [
  { text: "RCTL(KC_B)", size: 112, corners: false },
  { text: "RCTL(KC_B)", size: 84, corners: false },
  { text: "TD(DANCE_0)", size: 84, corners: true },
  { text: longName, size: 84, corners: true, compactTap: "Space" },
  { text: longName, size: 112, corners: true },
  { text: "W".repeat(200), size: 84, corners: true, compactTap: "W".repeat(200) },
];
let replaceLong: ((short: boolean) => void) | undefined;
function Fixture() {
  const [short, setShort] = useState(false);
  useLayoutEffect(() => { replaceLong = setShort; }, []);
  return <main style={{ padding: 16 }}>
    <h1 style={{ fontSize: 20 }}>Key-card fit regression</h1>
    <pre id="result" role="status" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14 }}>Checking rendered labels…</pre>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
      {cases.map((value, index) => <section key={index} data-case={index} style={{ padding: 12, border: "1px solid var(--line-2)", borderRadius: 12 }}>
        <h2 style={{ fontSize: 14 }}>{value.size}px · {value.corners ? "Filled corners" : "Plain tap"}</h2>
        <div className="card-hero">
          <HeroCap legend={{ tap: short && index === 3 ? "A" : value.text }} compactTap={value.compactTap ?? "Esc"} tone="tapDance" hold={{ text: "Control", name: "When held" }}
            doubleTap={value.corners ? { text: "B", name: "When double-tapped" } : null} tapThenHold={value.corners ? { text: "C", name: "When tapped, then held" } : null}
            open="tap" draft={false} onOpen={() => {}} label="Synthetic tap-dance action" size={short && index === 3 ? 112 : value.size} />
        </div>
      </section>)}
    </div>
  </main>;
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const check = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };
async function run() {
  const output = document.querySelector("#result");
  if (!output) throw new Error("Missing result element");
  try {
    await document.fonts.ready;
    await frame();
    for (const [index, value] of cases.entries()) {
      const card = document.querySelector(`[data-case="${index}"]`)!;
      const tap = card.querySelector(".hero-tap")!;
      const label = tap.querySelector(".cap-tap:not(.hero-fit-probe)")!;
      const box = tap.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(label);
      for (const line of range.getClientRects()) {
        check(line.left >= box.left - 1 && line.right <= box.right + 1 && line.top >= box.top - 1 && line.bottom <= box.bottom + 1, `Case ${index}: label exceeds its tap region`);
      }
      check(parseFloat(getComputedStyle(label).fontSize) >= 11, `Case ${index}: text falls below the font floor`);
      check(tap.getAttribute("aria-label")?.includes(value.text) === true, `Case ${index}: full accessible name is missing`);
      if (index >= 3) check(card.querySelector(".hero-source span")?.textContent === value.text, `Case ${index}: full name is missing from the visible caption`);
      if (index === 5) check(label.textContent === "Tap", "An oversized plain label also overflows the cap");
    }
    replaceLong?.(true);
    await frame();
    check(!document.querySelector('[data-case="3"] .hero-source'), "Changing to a short label leaves a stale caption");
    replaceLong?.(false);
    await frame();
    check(document.querySelector('[data-case="3"] .hero-source span')?.textContent === longName, "Changing back loses the long name");
    output.textContent = "PASS: six rendered cases, full names, font floor and label changes";
    document.body.dataset.result = "passed";
  } catch (error) {
    output.textContent = `FAIL: ${String(error)}`;
    document.body.dataset.result = "failed";
  }
}
createRoot(document.querySelector("#root")!).render(<Fixture />);
void frame().then(run);
