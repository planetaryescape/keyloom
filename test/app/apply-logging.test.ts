import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyChange, applyOps, closeApp, getLayout, proposeChange } from "../../src/app/index.ts";
import { optionOptionApp } from "../helpers/option-option.ts";
import { setKey } from "../helpers/ops.ts";

test("editor and proposed applies log committed IDs and codes, never summaries or ops", async () => {
  const { app, layoutId } = await optionOptionApp();
  try {
    const first = applyOps(app, layoutId, {
      baseRevisionId: getLayout(app, layoutId).revision.id,
      ops: setKey(33, "F17"), summary: "private summary not for the log", reason: "private reason",
    });
    const proposal = proposeChange(app, layoutId, { ops: setKey(33, "F18"), explanation: "private proposal", source: "agent" });
    const second = applyChange(app, proposal.id);
    const log = readFileSync(join(app.dataDir, "logs", "keyloom.log"), "utf8");
    const rows = log.trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ event: "apply", layoutId, revisionId: first.revisionId, changeSetId: first.changeSetId, decisionId: first.decisionId, source: "editor", ok: true, errorCodes: [] });
    expect(rows[1]).toMatchObject({ event: "apply", layoutId, revisionId: second.revisionId, changeSetId: second.changeSetId, decisionId: null, source: "agent", ok: true });
    expect(log).not.toContain("private");
    expect(log).not.toContain("setBinding");
  } finally {
    closeApp(app);
  }
});

test("a database rollback leaves neither a revision nor an apply log", async () => {
  const { app, layoutId } = await optionOptionApp();
  try {
    const before = getLayout(app, layoutId).revision.id;
    app.db.run("CREATE TRIGGER refuse_revision BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END");
    expect(() => applyOps(app, layoutId, { baseRevisionId: before, ops: setKey(33, "F17"), summary: "must roll back" })).toThrow("synthetic disk failure");
    expect(getLayout(app, layoutId).revision.id).toBe(before);
    expect(existsSync(join(app.dataDir, "logs", "keyloom.log"))).toBe(false);
  } finally {
    closeApp(app);
  }
});
