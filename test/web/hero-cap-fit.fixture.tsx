// Real key cards and loaded fonts. Synthetic labels only; no server API, model or keyboard.
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HeroCap } from "../../src/web/card/HeroCap.tsx";
import aplus from "../../boards/ploopy/aplus/board.json" with { type: "json" };
import "../../src/web/fonts/fonts.css";
import "../../src/web/tokens.css";
import "../../src/web/app.css";
import "../../src/web/keyboard/keyboard.css";
import "../../src/web/card/card.css";

const longName = `tap-dance td_${"long_identifier_".repeat(12)}`;
type Shape = Parameters<typeof HeroCap>[0]["shape"];
const aplusShape = aplus.display.keyShapes["0"] as Shape;
const cases: { text: string; size: number; corners: boolean; compactTap?: string; shape?: Shape }[] = [
  { text: "RCTL(KC_B)", size: 112, corners: false },
  { text: "RCTL(KC_B)", size: 84, corners: false },
  { text: "TD(DANCE_0)", size: 84, corners: true },
  { text: longName, size: 84, corners: true, compactTap: "Space" },
  { text: longName, size: 112, corners: true },
  { text: "W".repeat(200), size: 84, corners: true, compactTap: "W".repeat(200) },
  { text: "A", size: 112, corners: true, shape: { profile: "flat", w: 4, h: 1 } },
  { text: "A", size: 84, corners: true, shape: aplusShape },
  { text: "A", size: 112, corners: true, shape: aplusShape },
];
let replaceLong: ((short: boolean) => void) | undefined;
function Fixture() {
  const [short, setShort] = useState(false);
  const [theme, setTheme] = useState("dark");
  useLayoutEffect(() => { replaceLong = setShort; }, []);
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return <main style={{ padding: 16 }}>
    <h1 style={{ fontSize: 20 }}>Key-card fit regression</h1>
    <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>Use the {theme === "dark" ? "light" : "dark"} theme</button>
    <pre id="result" role="status" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 14 }}>Checking rendered labels…</pre>
    <p role="status" id="opened">No slot opened</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
      {cases.map((value, index) => <section key={index} data-case={index} style={{ padding: 12, border: "1px solid var(--line-2)", borderRadius: 12 }}>
        <h2 style={{ fontSize: 14 }}>Case {index} · {value.size}px · {value.corners ? "Filled corners" : "Plain tap"}</h2>
        <div className="card-hero">
          <HeroCap legend={{ tap: short && index === 3 ? "A" : value.text }} compactTap={value.compactTap ?? "Esc"} tone="tapDance" hold={{ text: "Control", name: "When held" }}
            doubleTap={value.corners ? { text: "B", name: "When double-tapped" } : null} tapThenHold={value.corners ? { text: "C", name: "When tapped, then held" } : null}
            open="tap" draft={false} onOpen={(slot) => { document.querySelector("#opened")!.textContent = `Opened ${slot} in case ${index}`; }} label="Synthetic tap-dance action" size={short && index === 3 ? 112 : value.size} shape={value.shape} />
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
      if (index >= 3 && index <= 5) check(card.querySelector(".hero-source span")?.textContent === value.text, `Case ${index}: full name is missing from the visible caption`);
      if (index === 5) check(label.textContent === "Tap", "An oversized plain label also overflows the cap");
      for (const corner of card.querySelectorAll<HTMLElement>(".hero-corner")) {
        const cornerBox = corner.getBoundingClientRect();
        const line = document.createRange();
        line.selectNodeContents(corner);
        for (const rect of line.getClientRects()) {
          check(rect.top >= cornerBox.top - 1 && rect.bottom <= cornerBox.bottom + 1, `Case ${index}: corner text exceeds its band`);
        }
        if (value.shape) check(cornerBox.bottom <= box.top + 1, `Case ${index}: corner overlaps the tap`);
      }
      const extra = card.querySelector(".hero-extra-slots");
      if (extra) {
        check(extra.getBoundingClientRect().top >= card.querySelector(".hero-cap")!.getBoundingClientRect().bottom - 1, `Case ${index}: extra slots overlap the physical button`);
        for (const button of extra.querySelectorAll("button")) {
          check(button.clientHeight >= 24 && parseFloat(getComputedStyle(button).fontSize) >= 11, `Case ${index}: extra slot is too small to read or click`);
        }
      }
    }
    replaceLong?.(true);
    await frame();
    check(!document.querySelector('[data-case="3"] .hero-source'), "Changing to a short label leaves a stale caption");
    replaceLong?.(false);
    await frame();
    check(document.querySelector('[data-case="3"] .hero-source span')?.textContent === longName, "Changing back loses the long name");
    output.textContent = "PASS: nine rendered cases, corner bands, external slots, full names, font floor and label changes";
    document.body.dataset.result = "passed";
  } catch (error) {
    output.textContent = `FAIL: ${String(error)}`;
    document.body.dataset.result = "failed";
  }
}
createRoot(document.querySelector("#root")!).render(<Fixture />);
void frame().then(run);
