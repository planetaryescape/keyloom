// The live Command-Shift eval checks every valid proposal in a run, not only the last (evals/command-shift-checks.ts).
import { describe, expect, test } from "bun:test";
import { chainChecks } from "../../evals/command-shift-checks.ts";
import { checkChange, getLayout } from "../../src/app/index.ts";
import type { ChangeOp } from "../../src/layout/change.ts";
import { commandShiftApp } from "../helpers/command-shift.ts";

const cmdShift = { kind: "modifier" as const, mods: ["LGUI", "LSFT"] as Array<"LGUI" | "LSFT"> };

describe("the chain checks of the Command-Shift eval", () => {
  test("an initial proposal on a transparent key, with nothing displaced, followed by an F16 revision, fails the displacement check", async () => {
    const { app, layoutId } = await commandShiftApp();
    const before = getLayout(app, layoutId).document;
    const transparent: ChangeOp[] = [{ op: "setBinding", at: { layerId: "layer-5", position: 1 }, binding: cmdShift }];
    const onF16: ChangeOp[] = [{ op: "dropFunction", function: "key:F16", reason: "BK barely uses it" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: cmdShift }];
    const chain = [transparent, onF16].map((ops) => ({ ops, validation: checkChange(app, layoutId, { ops }) }));
    // The real fixture: the first proposal is valid, places Command-Shift and displaces nothing; the second drops F16.
    expect(chain.map((p) => p.validation.ok)).toEqual([true, true]);
    expect(chain[0]?.validation.diff.displaced.length).toBe(0);
    expect(chain[0]?.validation.diff.dropped.length).toBe(0);
    expect(chain[1]?.validation.diff.dropped.length).toBe(1);

    // Checking only the last, or only some, would pass; the chain does not.
    expect(chainChecks(before, [chain[1] as never])).toEqual({ everyValidOneGivesCommandShift: true, displacedShown: true });
    expect(chainChecks(before, chain)).toEqual({ everyValidOneGivesCommandShift: true, displacedShown: false });
  });

  test("a proposal in the chain that places no Command-Shift fails the placement check, and an empty chain passes nothing", async () => {
    const { app, layoutId } = await commandShiftApp();
    const before = getLayout(app, layoutId).document;
    const wrong: ChangeOp[] = [{ op: "dropFunction", function: "key:F16", reason: "x" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: { kind: "key", code: "F17" } }];
    const right: ChangeOp[] = [{ op: "dropFunction", function: "key:F16", reason: "x" }, { op: "setBinding", at: { layerId: "layer-0", position: 6 }, binding: cmdShift }];
    const chain = [wrong, right].map((ops) => ({ ops, validation: checkChange(app, layoutId, { ops }) }));
    expect(chainChecks(before, chain).everyValidOneGivesCommandShift).toBe(false);
    expect(chainChecks(before, [])).toEqual({ everyValidOneGivesCommandShift: false, displacedShown: false });
  });

  test("right Command with right Shift counts as Command-Shift: the first proposal of the 2026-10-29 OpenRouter run", async () => {
    const { app, layoutId } = await commandShiftApp();
    const before = getLayout(app, layoutId).document;
    // Its ops, copied from evals/reports/2026-10-29-openrouter-anthropic-claude-opus-5.5-medium-command-shift.md.
    const right: ChangeOp[] = [{ op: "setBinding", at: { layerId: "layer-0", position: 53 }, binding: { kind: "modifier", mods: ["RGUI", "RSFT"] } }];
    const chain = [{ ops: right, validation: checkChange(app, layoutId, { ops: right }) }];
    expect(chain[0]?.validation.ok).toBe(true);
    expect(chainChecks(before, chain).everyValidOneGivesCommandShift).toBe(true);
  });
});
