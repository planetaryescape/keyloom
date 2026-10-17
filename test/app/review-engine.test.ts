// When the board review runs (D-340): on connect, on a new head once it has settled, on an import, and never twice for a revision.
// The engine runs on a clock these tests move and looks only when they call `tick()`, so no test depends on how long a runner takes.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { importLayout } from "../../src/app/index.ts";
import type { ReviewEvent } from "../../src/app/review.ts";
import { ReviewEngine } from "../../src/app/review-engine.ts";
import { findRevision } from "../../src/persistence/layouts.ts";
import { failOrphanedRuns, findReviewOfRevision, latestReview } from "../../src/persistence/reviews.ts";
import { claimAi, insertReview } from "../../src/persistence/reviews.ts";
import { FIXTURE_DIR } from "../helpers/board.ts";
import { type SyncWorld, skewedClock, syncWorld } from "../helpers/fake-sync.ts";
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

const QUIET = 10_000;

/**
 * An engine that looks only when the test calls `tick()`, on a clock the test moves (as the sync tests do): the quiet time ends
 * when `clock.advance(QUIET)` says so. The sync engine is held the same way (`syncEngine`): it reads the keyboard when the test says.
 */
function reviewer(w: SyncWorld, model = emptyReviews()) {
  const clock = skewedClock();
  const engine = new ReviewEngine(w.app, model.deps, { quietMs: QUIET, tickMs: 600_000, now: clock.now });
  engines.push(engine);
  const events: ReviewEvent[] = [];
  engine.subscribe((e) => void events.push(e));
  /**
   * Starts the engine once the head the world made is older than its start by a millisecond at least. Heads are stamped to the
   * millisecond and the engine calls a head "made since I started" when it is not older, so a start in the head's own millisecond
   * reviews the world's first config as an import (docs/issues/flaky-review-engine-test.md, closed by the commit that added this).
   */
  const start = async (watch?: Parameters<ReviewEngine["start"]>[0]) => {
    const created = findRevision(w.app.db, w.layoutId, w.head())?.revision.createdAt ?? 0;
    while (Date.now() <= created) await Bun.sleep(1);
    engine.start(watch);
  };
  return { engine, model, events, clock, start };
}

const reviews = (w: SyncWorld) => (w.app.db.query("SELECT trigger, revision_id, ai_status FROM board_reviews ORDER BY checked_at").all() as Array<{ trigger: string; revision_id: string; ai_status: string }>);

describe("connect", () => {
  test("reviews the config on the keyboard when the keyboard shows up, and the model is asked once", async () => {
    const w = await world();
    const sync = w.engine({ tickMs: 600_000, pollMs: 0 });
    const r = reviewer(w);
    await r.start(sync);
    await sync.start();
    r.clock.advance(QUIET);
    await r.engine.tick();
    // Not plugged in, and nothing changed since keyloom started: nothing to look at.
    expect(reviews(w)).toEqual([]);

    w.flashed();
    await sync.tick();
    await r.engine.tick();
    expect(reviews(w)).toEqual([{ trigger: "connect", revision_id: w.head(), ai_status: "done" }]);
    expect(r.model.requests).toHaveLength(2);
    expect(r.events.map((e) => e.aiStatus)).toEqual(["pending", "running", "done"]);
  });

  test("a keyboard that was already there when keyloom started is reviewed, once, however often it reconnects", async () => {
    const w = await world();
    w.flashed();
    const sync = w.engine({ tickMs: 600_000, pollMs: 0 });
    const r = reviewer(w);
    await r.start(sync);
    await sync.start();
    r.clock.advance(QUIET);
    await r.engine.tick();
    expect(reviews(w)).toHaveLength(1);

    const keyboard = w.world.reading;
    w.world.reading = { state: "absent" };
    await sync.tick();
    await r.engine.tick();
    w.world.reading = keyboard;
    await sync.tick();
    await r.engine.tick();
    expect(reviews(w)).toHaveLength(1);
    expect(r.model.requests).toHaveLength(2);
  });

  test("with no model the review is still made, and says why the agent's part is missing", async () => {
    const w = await world();
    w.flashed();
    const sync = w.engine({ tickMs: 600_000, pollMs: 0 });
    const r = reviewer(w, { ...emptyReviews(), deps: noModel });
    await r.start(sync);
    await sync.start();
    r.clock.advance(QUIET);
    await r.engine.tick();
    expect(reviews(w).map((x) => x.ai_status)).toEqual(["unavailable"]);
    expect(latestReview(w.app.db, w.layoutId)?.ai.reason).toContain("No model provider is set up");
  });
});

describe("apply and import", () => {
  test("a burst of Applies is one review, of the last of them, after the quiet time", async () => {
    const w = await world();
    const r = reviewer(w);
    await r.start();
    w.apply();
    w.apply();
    const last = w.apply();
    // However slowly the Applies ran, no time has passed for the engine, so it is still inside the quiet time.
    await r.engine.tick();
    expect(reviews(w)).toEqual([]);

    r.clock.advance(QUIET);
    await r.engine.tick();
    expect(reviews(w)).toEqual([{ trigger: "apply", revision_id: last, ai_status: "done" }]);
    expect(r.model.requests).toHaveLength(2);
  });

  test("an Apply on a connected board is labelled apply, not connect; connect is for a head that was already there", async () => {
    const w = await world();
    w.flashed();
    const sync = w.engine({ tickMs: 600_000, pollMs: 0 });
    const r = reviewer(w);
    await r.start(sync);
    await sync.start();
    const first = w.head();
    r.clock.advance(QUIET);
    await r.engine.tick();
    expect(findReviewOfRevision(w.app.db, w.layoutId, first)?.ai.status).toBe("done");

    const next = w.apply();
    r.clock.advance(QUIET);
    await r.engine.tick();
    expect(findReviewOfRevision(w.app.db, w.layoutId, next)?.ai.status).toBe("done");
    expect(reviews(w).map((x) => x.trigger)).toEqual(["connect", "apply"]);
  });

  test("a revision that has a review is not reviewed again, whatever else changes", async () => {
    const w = await world();
    const r = reviewer(w);
    await r.start();
    const head = w.apply();
    r.clock.advance(QUIET);
    await r.engine.tick();
    expect(findReviewOfRevision(w.app.db, w.layoutId, head)?.ai.status).toBe("done");
    r.clock.advance(QUIET);
    await r.engine.tick();
    expect(r.model.requests).toHaveLength(2);
    expect(reviews(w)).toHaveLength(1);

    const next = w.apply();
    r.clock.advance(QUIET);
    await r.engine.tick();
    expect(findReviewOfRevision(w.app.db, w.layoutId, next)?.ai.status).toBe("done");
    expect(reviews(w).map((x) => x.revision_id)).toEqual([head, next]);
    expect(r.model.requests).toHaveLength(4);
  });

  test("an import made while keyloom runs is reviewed as an import", async () => {
    const w = await world();
    const r = reviewer(w);
    await r.start();
    const imported = await importLayout(w.app, { board: "zsa/moonlander", source: FIXTURE_DIR, name: "second" });
    r.clock.advance(QUIET);
    await r.engine.tick();
    expect(findReviewOfRevision(w.app.db, imported.layoutId, imported.revisionId)?.ai.status).toBe("done");
    expect(findReviewOfRevision(w.app.db, imported.layoutId, imported.revisionId)?.trigger).toBe("import");
  });

  test("a config that was archived is left alone", async () => {
    const w = await world();
    const r = reviewer(w);
    await r.start();
    w.app.db.query("UPDATE layouts SET archived_at = ? WHERE id = ?").run(Date.now(), w.layoutId);
    w.apply();
    r.clock.advance(QUIET);
    await r.engine.tick();
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
