import { expect, test } from "bun:test";
import { runCli } from "../../src/cli/main.ts";
import type { WorkloadDeps } from "../../src/app/workload.ts";
import type { Io } from "../../src/cli/output.ts";
import { getLayout } from "../../src/app/layouts.ts";
import { replayResult, stroke, suiteText, workloadApp } from "../helpers/workload.ts";
import { tempDir } from "../helpers/tmp.ts";

async function cli(args: string[], workload?: WorkloadDeps) {
  let out = ""; let err = "";
  const io: Io = { out: (s) => { out += s; }, err: (s) => { err += s; }, isTTY: false };
  const code = await runCli(args, io, {}, undefined, undefined, undefined, undefined, workload);
  return { code, out, err };
}
test("workload list needs no layout, AI, hardware or Docker and supports global formats", async () => {
  const dir = tempDir();
  const result = await cli(["--data-dir", dir, "workload", "list"]);
  expect(result.code).toBe(0); expect(result.err).toBe("");
  expect(JSON.parse(result.out).suites.map((s: { id: string }) => s.id)).toEqual(["prose", "typescript", "python", "json", "shell", "shortcuts"]);
  const ids = await cli(["--data-dir", dir, "--format", "ids", "workload", "list"]);
  expect(ids.out).toBe("prose\ntypescript\npython\njson\nshell\nshortcuts\n");
});
test("evaluate prints one deterministic JSON document; progress stays stderr, full-task replay once", async () => {
  const { app, dir, layoutId } = workloadApp();
  try {
    const path = `${dir}/suite.json`; await Bun.write(path, JSON.stringify(suiteText("see")));
    let calls = 0;
    const deps: WorkloadDeps = { replay: async (_app, _view, events, options) => {
      calls++; expect(events.length).toBe(8); expect(options.cache).toBe(false); options.onProgress?.("synthetic progress");
      return replayResult([...stroke(0, "S"), ...stroke(30, "E"), ...stroke(50, "E")]);
    } };
    const args = ["--data-dir", dir, "workload", "evaluate", layoutId, "--suite", path];
    const a = await cli(args, deps); const b = await cli(args, deps);
    expect(a.code).toBe(0); expect(a.out).toBe(b.out); expect(calls).toBe(2);
    const json = JSON.parse(a.out); expect(json.schema_version).toBe(1); expect(json.tasks[0].status).toBe("verified");
    expect(a.out).not.toContain("synthetic progress");
    const table = await cli(["--data-dir", dir, "--format", "table", "workload", "evaluate", layoutId, "--suite", path], deps);
    expect(table.out).toContain("1/1 tasks verified"); expect(table.out).toContain("4 keydowns");
  } finally { app.db.close(); }
});
test("compare accepts existing ops envelope and does not move the stored head", async () => {
  const { app, dir, layoutId } = workloadApp();
  try {
    const head = getLayout(app, layoutId).revision.id;
    await Bun.write(`${dir}/suite.json`, JSON.stringify(suiteText("see")));
    await Bun.write(`${dir}/ops.json`, JSON.stringify({ ops: [{ op: "setBinding", at: { layerId: "base", position: 3 }, binding: { kind: "key", code: "E" } }, { op: "dropFunction", function: "key:V", reason: "test" }] }));
    const r = await cli(["--data-dir", dir, "workload", "compare", layoutId, "--suite", `${dir}/suite.json`, "--ops", `${dir}/ops.json`], { replay: async () => replayResult([...stroke(0, "S"), ...stroke(30, "E"), ...stroke(50, "E")]) });
    expect(r.code).toBe(0); expect(JSON.parse(r.out)).toMatchObject({ saved: false, applied: false, comparison: { verdict: "verified-improvement" } });
    expect(getLayout(app, layoutId).revision.id).toBe(head);
  } finally { app.db.close(); }
});
test("invalid CLI inputs use normal exit 2 and never reach replay", async () => {
  const { app, dir, layoutId } = workloadApp();
  try {
    const flags = ["--data-dir", dir, "workload", "evaluate", layoutId];
    for (const extra of [["--builtin", "missing"], ["--builtin", "prose", "--suite", "x"], ["--suite", "/not-a-file"], ["--board-rev", "typo"]]) {
      const r = await cli([...flags, ...extra], { replay: async () => { throw new Error("must not run"); } });
      expect(r.code).toBe(2); expect(r.out).toBe(""); expect(JSON.parse(r.err).error.message).toBeString();
    }
  } finally { app.db.close(); }
});

test("build/replay failure retains deterministic evidence, puts diagnostics on stderr and exits 7", async () => {
  const { app, dir, layoutId } = workloadApp();
  try {
    await Bun.write(`${dir}/suite.json`, JSON.stringify(suiteText("s")));
    const r = await cli(["--data-dir", dir, "workload", "evaluate", layoutId, "--suite", `${dir}/suite.json`], { replay: async () => { throw new Error("synthetic build failure (/private/transient/log)"); } });
    expect(r.code).toBe(7); expect(r.err).toContain("synthetic build failure"); expect(r.out).not.toContain("/private/transient/log");
    expect(JSON.parse(r.out).tasks[0]).toMatchObject({ status: "execution-error", costsVerified: false });
  } finally { app.db.close(); }
});
