// Run only with explicit Docker opt-in and through agent-work's shared queue. Never uses hardware.
import { describe, expect, test } from "bun:test";
import { evaluateStoredWorkload } from "../../../src/app/workload.ts";
import { tinyLayout, key, none, suiteText, workloadApp } from "../../helpers/workload.ts";

const qmk = ["1", "qmk"].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? describe : describe.skip;
qmk("workload evidence on QMK's real core", () => {
  test("a whole layered see witness verifies exact reports and shared control cost", async () => {
    const { app, layoutId } = workloadApp();
    try {
      const r = await evaluateStoredWorkload(app, layoutId, { suite: suiteText("see"), boardRevision: "reva" });
      expect(r.tasks[0]).toMatchObject({ status: "verified", costsVerified: true, costs: { physicalKeydowns: 4, layerEntries: 1, maxSimultaneousKeys: 2 } });
      expect(r.tasks[0]?.verification?.actual).toEqual([{ key: "S", mods: [] }, { key: "E", mods: [] }, { key: "E", mods: [] }]);
    } finally { app.db.close(); }
  }, 300_000);
});
const zmk = ["1", "zmk"].includes(process.env.KEYLOOM_DOCKER_TESTS ?? "") ? describe : describe.skip;
zmk("workload evidence on ZMK's real core", () => {
  test("the same layered see workload verifies on a different board and firmware", async () => {
    const layout = tinyLayout(undefined, [{ kind: "transparent" }, none, key("E"), none]); layout.firmware = "zmk"; layout.boardId = "moergo/glove80";
    const { app, layoutId } = workloadApp(layout);
    try {
      const r = await evaluateStoredWorkload(app, layoutId, { suite: suiteText("see") });
      expect(r.tasks[0]).toMatchObject({ status: "verified", costsVerified: true, costs: { physicalKeydowns: 4, layerEntries: 1, maxSimultaneousKeys: 2 } });
      expect(r.tasks[0]?.verification?.actual).toEqual([{ key: "S", mods: [] }, { key: "E", mods: [] }, { key: "E", mods: [] }]);
    } finally { app.db.close(); }
  }, 300_000);
});
