import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LabStage } from "../../src/web/lab/LabScreens.tsx";
import type { Lab } from "../../src/web/lab/useLab.ts";

for (const phone of [false, true]) {
  test(`saved incomplete recording remains visible on ${phone ? "phone" : "desktop"}`, () => {
    const lab: Lab = {
      phase: { kind: "start" }, passages: [], canRecord: { ok: true, why: null }, sessions: [], typed: "",
      problem: "This recording is incomplete. Start a new recording; the partial recording is still saved.",
      setTyped: () => {}, start: async () => {}, stop: async () => {}, cancel: async () => {},
      showSession: async () => {}, remove: async () => {}, openFinding: () => {}, tryFix: () => {}, again: () => {},
    };
    const html = renderToStaticMarkup(<LabStage lab={lab} boardName="Moonlander" phone={phone} onClose={() => {}} onType={() => {}} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("This recording is incomplete.");
    expect(html).toContain("partial recording is still saved");
    if (phone) expect(html).not.toContain("Start listening");
    else expect(html).toContain("Start listening");
  });
}
