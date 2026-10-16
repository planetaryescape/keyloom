// When the board review runs (D-340): on connect, on a new head once it has settled, on an import, and never twice for a revision.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { importLayout } from "../../src/app/index.ts";
import type { ReviewEvent } from "../../src/app/review.ts";
import { ReviewEngine } from "../../src/app/review-engine.ts";
import { failOrphanedRuns, findReviewOfRevision, latestReview } from "../../src/persistence/reviews.ts";
import { claimAi, insertReview } from "../../src/persistence/reviews.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { type SyncWorld, syncWorld, waitFor } from "../helpers/fake-sync.ts";
import { finished, noModel, scriptedModel, submit } from "../helpers/review-world.ts";

setDefaultTimeout(20_000);

let worlds: SyncWorld[] = [];
const engines: ReviewEngine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop();
  for (const w of worlds) await w.stopAll();
  worlds = [];
});

/** A model that answers any number of reviews with an empty one; `requests` counts the calls it was sent. */
const emptyReviews = (n = 10) => scriptedModel(Array.from({ length: n }, () => [submit([]), finished]).flat());

async function world() {
  const w = await syncWorld();
  worlds.push(w);
  return w;
}

function reviewer(w: SyncWorld, model = emptyReviews(), quietMs = 60) {
  const engine = new ReviewEngine(w.app, model.deps, { quietMs, tickMs: 10 });
  engines.push(engine);
  const events: ReviewEvent[] = [];
  engine.subscribe((e) => void events.push(e));
  return { engine, model, events };
}

const reviews = (w: SyncWorld) => (w.app.db.query("SELECT trigger, revision_id, ai_status FROM board_reviews ORDER BY checked_at").all() as Array<{ trigger: string; revision_id: string; ai_status: string }>);

describe("connect", () => {
  test("reviews the config on the keyboard when the keyboard shows up, and the model is asked once", async () => {
    const w = await world();
    const sync = w.engine();
    const r = reviewer(w);
    r.engine.start(sync);
    await sync.start();
    await Bun.sleep(150);
    // Not plugged in, and nothing changed since keyloom started: nothing to look at.
    expect(reviews(w)).toEqual([]);

    w.flashed();
    await waitFor(() => reviews(w).some((x) => x.ai_status === "done"), "a review after the keyboard connected");
    expect(reviews(w)).toEqual([{ trigger: "connect", revision_id: w.head(), ai_status: "done" }]);
    expect(r.model.requests).toHaveLength(2);
    expect(r.events.map((e) => e.aiStatus)).toEqual(["pending", "running", "done"]);
  });

  test("a keyboard that was already there when keyloom started is reviewed, once, however often it reconnects", async () => {
    const w = await world();
    w.flashed();
    const sync = w.engine();
    const r = reviewer(w);
    r.engine.start(sync);
    await sync.start();
    await waitFor(() => reviews(w).some((x) => x.ai_status === "done"), "the first review");

    const keyboard = w.world.reading;
    w.world.reading = { state: "absent" };
    await sync.tick();
    await Bun.sleep(60);
    w.world.reading = keyboard;
    await sync.tick();
    await Bun.sleep(150);
    expect(reviews(w)).toHaveLength(1);
    expect(r.model.requests).toHaveLength(2);
  });

  test("with no model the review is still made, and says why the agent's part is missing", async () => {
    const w = await world();
    w.flashed();
    const sync = w.engine();
    const engine = new ReviewEngine(w.app, noModel, { quietMs: 40, tickMs: 10 });
    engines.push(engine);
    engine.start(sync);
    await sync.start();
    await waitFor(() => reviews(w).some((x) => x.ai_status === "unavailable"), "an unavailable review");
    expect(latestReview(w.app.db, w.layoutId)?.ai.reason).toContain("No model provider is set up");
  });
});

describe("apply and import", () => {
  test("a burst of Applies is one review, of the last of them, after the quiet time", async () => {
    const w = await world();
    const r = reviewer(w, emptyReviews(), 200);
    r.engine.start();
    w.apply();
    await Bun.sleep(60);
    w.apply();
    await Bun.sleep(60);
    const last = w.apply();
    await Bun.sleep(100);
    // Still inside the quiet time after the last one.
    expect(reviews(w)).toEqual([]);

    await waitFor(() => reviews(w).some((x) => x.ai_status === "done"), "the review after the quiet time");
    expect(reviews(w)).toEqual([{ trigger: "apply", revision_id: last, ai_status: "done" }]);
    expect(r.model.requests).toHaveLength(2);
  });

  test("a revision that has a review is not reviewed again, whatever else changes", async () => {
    const w = await world();
    const r = reviewer(w);
    r.engine.start();
    const head = w.apply();
    await waitFor(() => findReviewOfRevision(w.app.db, w.layoutId, head)?.ai.status === "done", "the review");
    await Bun.sleep(200);
    expect(r.model.requests).toHaveLength(2);
    expect(reviews(w)).toHaveLength(1);

    const next = w.apply();
    await waitFor(() => findReviewOfRevision(w.app.db, w.layoutId, next)?.ai.status === "done", "the next review");
    expect(reviews(w).map((x) => x.revision_id)).toEqual([head, next]);
    expect(r.model.requests).toHaveLength(4);
  });

  test("an import made while keyloom runs is reviewed as an import", async () => {
    const w = await world();
    const r = reviewer(w);
    r.engine.start();
    const imported = await importLayout(w.app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "second" });
    await waitFor(() => findReviewOfRevision(w.app.db, imported.layoutId, imported.revisionId)?.ai.status === "done", "the import's review");
    expect(findReviewOfRevision(w.app.db, imported.layoutId, imported.revisionId)?.trigger).toBe("import");
  });

  test("a config that was archived is left alone", async () => {
    const w = await world();
    const r = reviewer(w);
    r.engine.start();
    w.app.db.query("UPDATE layouts SET archived_at = ? WHERE id = ?").run(Date.now(), w.layoutId);
    w.apply();
    await Bun.sleep(250);
    expect(reviews(w)).toEqual([]);
    expect(r.model.requests).toHaveLength(0);
  });
});

describe("a restart", () => {
  test("a run the last process left running is failed, so its screen stops waiting", async () => {
    const w = await world();
    const { review } = insertReview(w.app.db, { layoutId: w.layoutId, revisionId: w.head(), trigger: "apply", checkedAt: Date.now(), summary: { layers: 1, keys: 1, combos: 0 }, items: [], previousReviewId: null, fixed: [] });
    expect(claimAi(w.app.db, review.id, Date.now(), 60_000)).toBe(true);
    const r = reviewer(w);
    r.engine.start();
    expect(latestReview(w.app.db, w.layoutId)?.ai).toMatchObject({ status: "failed", reason: expect.stringContaining("closed while it was looking") });
    expect(failOrphanedRuns(w.app.db, "x")).toBe(0);
  });
});
