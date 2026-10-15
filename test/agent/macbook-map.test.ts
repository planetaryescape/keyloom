// Rung 19's cross-board mapping onto the MacBook (21#copying-the-other-boards-setup-onto-it): the Moonlander's typing block lands
// by function, its thumb layer keys get placement proposals instead of a forced key, and its hold-tap profiles come out as kanata ones.
import { describe, expect, test } from "bun:test";
import { createTools } from "../../src/agent/tools/index.ts";
import type { ModelTool } from "../../src/agent/model.ts";
import { createAgentPorts } from "../../src/app/agent-ports.ts";
import { applyOps, getLayout, importLayout, openApp } from "../../src/app/index.ts";
import { identityLayout } from "../../src/firmware/kanata/identity.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { macbook } from "../helpers/macbook.ts";
import { tempDir } from "../helpers/tmp.ts";

async function world() {
  const app = openApp({ dataDir: tempDir() });
  const moon = await importLayout(app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "my-moonlander" });
  const mac = createLayout(app.db, { name: "my-macbook", layout: identityLayout(macbook()), summary: "identity", origin: "import" });
  const list = createTools(createAgentPorts(app, mac.layout.id, "conv_test"), { validation() {} } as never, { onProposal() {}, onPriority() {} });
  const run = async (name: string, input: unknown = {}) => String(await (list.find((t) => t.name === name) as ModelTool).run(input));
  return { app, moon, mac, run };
}

const opsIn = (text: string): ChangeOp[] => JSON.parse(text.split("\n").find((l) => l.startsWith("[{") || l === "[]") ?? "[]") as ChangeOp[];

describe("the Moonlander onto the MacBook", () => {
  test("the typing block matches by function, and thumb layer keys get proposals instead of a forced key", async () => {
    const { run } = await world();
    const text = await run("map_keys", { from: "my-moonlander" });
    expect(text).toContain("MacBook keyboard (ANSI)");
    expect(text).toMatch(/\[A\][^\n]*->[^\n]*\[A\]: function/);
    expect(text).toContain("has fewer thumb keys");
    // Space-hold first, then Caps Lock, then right Option (D-234).
    const proposal = text.split("\n").find((l) => l.includes("fewer thumb keys")) ?? "";
    const order = [proposal.indexOf("[SPC]"), proposal.indexOf("[CAPS]"), proposal.indexOf("[RALT]")];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("a home-row hold-tap carried onto the MacBook comes with a kanata profile, and the ops pass the validator", async () => {
    const { app, moon, mac, run } = await world();
    const moonDoc = getLayout(app, moon.layoutId).document;
    const home = new Set(getLayout(app, moon.layoutId).board.definition.rows.home);
    const holdTaps = moonDoc.layers[0]!.bindings.flatMap((b, p) => (b.kind === "holdTap" && "mods" in b.hold && home.has(p) ? [p] : []));
    expect(holdTaps.length).toBeGreaterThan(0);
    const text = await run("map_keys", { from: "my-moonlander", carry: "behaviours", positions: holdTaps });
    const ops = opsIn(text);
    const profile = ops.find((o) => o.op === "upsertHoldTapProfile");
    expect(profile).toBeDefined();
    if (profile?.op === "upsertHoldTapProfile") {
      expect(profile.profile.firmware).toBe("kanata");
      expect(profile.profile.options.variant).toMatch(/^tap-hold/);
      expect(typeof profile.profile.options["hold-ms"]).toBe("number");
    }
    expect(text).toContain("Validation of these ops: ");
    expect(text).toContain('Validation of these ops: {"ok":true');
    // They apply to the MacBook layout through the editor's own path.
    const head = getLayout(app, mac.layout.id).revision.id;
    const applied = applyOps(app, mac.layout.id, { baseRevisionId: head, ops, summary: "copy home-row mods from the Moonlander" });
    expect(applied.validation.ok).toBe(true);
    const after = getLayout(app, mac.layout.id).document;
    expect(after.holdTapProfiles.every((p) => p.firmware === "kanata")).toBe(true);
    expect(after.layers[0]!.bindings.some((b) => b.kind === "holdTap")).toBe(true);
  });

  test("the MacBook says plainly it can't show per-key colours", async () => {
    const { run } = await world();
    const text = await run("map_keys", { from: "my-moonlander", carry: "lighting" });
    expect(text).toContain("can't show per-key colours because");
    expect(text).not.toContain("setLayerLighting");
  });
});
