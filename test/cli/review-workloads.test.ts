import { expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import { getLayout, layoutExportDocument } from "../../src/app/index.ts";
import { reviewActivities } from "../../src/persistence/review-workloads.ts";
import { finished, scriptedModel, submit } from "../helpers/review-world.ts";
import { key, replayResult, tinyLayout, workloadApp } from "../helpers/workload.ts";
import type { WorkloadDeps } from "../../src/app/workload.ts";
import { importLayout } from "../../src/app/layouts.ts";
import { saveReviewActivities } from "../../src/app/review-workloads.ts";

async function cli(dir: string, args: string[], workload?: WorkloadDeps) {
  let out = ""; let err = "";
  const m = scriptedModel([submit([]), finished]);
  const code = await runCli(["--data-dir", dir, "--format", "json", ...args], { out: (s) => { out += s; }, err: (s) => { err += s; }, isTTY: false }, { model: m.model }, undefined, undefined, undefined, undefined, workload ?? { replay: async () => { throw new Error("This tiny fixture has no route for the selected samples"); } });
  return { code, out, err };
}

test("review CLI remembers explicit activities, exposes gaps, and supports turning tests off", async () => {
  const w = workloadApp();
  try {
    const before = getLayout(w.app, w.layoutId);
    const run = await cli(w.dir, ["review", "workload-test", "--run", "--activities", "prose,shortcuts"]);
    expect(run.code).toBe(0);
    const result = JSON.parse(run.out);
    expect(result.workload_activities).toEqual(["prose", "shortcuts"]);
    expect(result.review.workload).toMatchObject({ activities: ["prose", "shortcuts"], status: "done" });
    expect(result.review.workload.baseline).toHaveLength(4);
    expect(result.review.workload.baseline.every((t: { physicalKeydowns: number | null }) => t.physicalKeydowns === null)).toBe(true);
    expect(JSON.parse((await cli(w.dir, ["review", "workload-test"])).out).review.workload).toEqual(result.review.workload);
    const disabled = await cli(w.dir, ["review", "workload-test", "--run", "--activities", "none"]);
    expect(disabled.code).toBe(0);
    expect(JSON.parse(disabled.out).review.workload).toBeUndefined();
    expect(reviewActivities(w.app.db, w.layoutId)).toEqual([]);
    expect(getLayout(w.app, w.layoutId)).toEqual(before);
  } finally { w.app.db.close(); }
});

test("bad activity arguments are usage errors, not default workloads", async () => {
  const w = workloadApp();
  try {
    for (const args of [
      ["--activities", "prose"], ["--run", "--activities", "gaming"], ["--run", "--activities", "prose,prose"], ["--run", "--activities", ""],
    ]) expect((await cli(w.dir, ["review", "workload-test", ...args])).code).toBe(2);
    expect(reviewActivities(w.app.db, w.layoutId)).toEqual([]);
    expect(w.app.db.query("SELECT count(*) AS n FROM board_reviews").get()).toEqual({ n: 0 });
  } finally { w.app.db.close(); }
});

test("import can select activities before the first automatic review", async () => {
  const w = workloadApp();
  try {
    const path = `${w.dir}/portable.json`;
    await Bun.write(path, JSON.stringify(layoutExportDocument(w.app, w.layoutId)));
    const result = await cli(w.dir, ["import", "--board", "zsa/moonlander", "--name", "Imported for writing", "--activities", "prose,shortcuts", path]);
    expect(result.code).toBe(0);
    const imported = JSON.parse(result.out);
    expect(reviewActivities(w.app.db, imported.layout_id)).toEqual(["prose", "shortcuts"]);
    expect(w.app.db.query("SELECT count(*) AS n FROM board_reviews").get()).toEqual({ n: 0 });
  } finally { w.app.db.close(); }
});

test("import and keyboard put accept none without starting tests or inheriting a source profile", async () => {
  const w = workloadApp();
  try {
    const path = `${w.dir}/none.json`;
    await Bun.write(path, JSON.stringify(layoutExportDocument(w.app, w.layoutId)));
    const imported = await cli(w.dir, ["import", "--board", "zsa/moonlander", "--name", "No activities", "--activities", "none", path]);
    expect(imported.code).toBe(0);
    expect(reviewActivities(w.app.db, JSON.parse(imported.out).layout_id)).toEqual([]);
    saveReviewActivities(w.app, w.layoutId, ["prose"]);
    const copied = await cli(w.dir, ["keyboard", "put", w.layoutId, "--on", "moergo/glove80", "--activities", "none"]);
    expect(copied.code).toBe(0);
    expect(reviewActivities(w.app.db, JSON.parse(copied.out).config.id)).toEqual([]);
    expect(w.app.db.query("SELECT count(*) AS n FROM board_reviews").get()).toEqual({ n: 0 });
    const invalid = await cli(w.dir, ["import", "--board", "zsa/moonlander", "--activities", "shortcut", path]);
    expect(invalid.code).toBe(2);
    expect(invalid.err).toContain("shortcuts");
  } finally { w.app.db.close(); }
});

test("Ctrl-C cancels workload review with exit 7 and cleans up signal listeners", async () => {
  const w = workloadApp(tinyLayout([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(key).concat([key("SPACE"), key("DOT"), key("ENTER")])));
  try {
    const listeners = process.listenerCount("SIGINT");
    let calls = 0;
    const result = await cli(w.dir, ["review", "workload-test", "--run", "--activities", "prose"], { replay: async () => {
      calls++; process.emit("SIGINT"); return replayResult([]);
    } });
    expect(calls).toBe(1);
    expect(result.code).toBe(7);
    expect(result.out).toBe("");
    expect(result.err).toContain("cancelled");
    expect(process.listenerCount("SIGINT")).toBe(listeners);
    expect(w.app.db.query("SELECT ai_status FROM board_reviews").get()).toEqual({ ai_status: "failed" });
  } finally { w.app.db.close(); }
});

test("import and its selected profile commit together or leave neither behind", async () => {
  const w = workloadApp();
  try {
    const path = `${w.dir}/atomic.json`;
    await Bun.write(path, JSON.stringify(layoutExportDocument(w.app, w.layoutId)));
    w.app.db.exec("CREATE TRIGGER fail_profile BEFORE INSERT ON review_workload_profiles BEGIN SELECT RAISE(ABORT, 'synthetic profile write failure'); END");
    const count = w.app.db.query("SELECT count(*) AS n FROM layouts").get();
    await expect(importLayout(w.app, { board: "zsa/moonlander", source: path, name: "Must roll back", reviewActivities: ["prose"] })).rejects.toThrow("synthetic profile write failure");
    expect(w.app.db.query("SELECT count(*) AS n FROM layouts").get()).toEqual(count);
    expect(w.app.db.query("SELECT count(*) AS n FROM review_workload_profiles").get()).toEqual({ n: 0 });
  } finally { w.app.db.close(); }
});
