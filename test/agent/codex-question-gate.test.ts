import { expect, test } from "bun:test";
import { questionGate } from "../../src/agent/codex/question-gate.ts";

const paused = (graceMs = 5) => {
  const gate = questionGate(graceMs);
  gate.started("question");
  gate.arrived();
  gate.pause();
  return gate;
};

test("Codex's failure report releases the question", () => {
  const gate = paused();
  gate.completed("question", false);
  expect(gate.isPaused()).toBe(false);
});

test("Codex's confirmation keeps the question, and a later failure cannot release it", () => {
  const gate = paused();
  gate.completed("question", true);
  gate.completed("other", false);
  expect(gate.isPaused()).toBe(true);
});

test("an earlier call's failure does not release the question that came after it", () => {
  const gate = questionGate(5);
  gate.started("bad");
  gate.arrived();
  gate.started("good");
  gate.arrived();
  gate.pause();
  gate.completed("bad", false);
  expect(gate.isPaused()).toBe(true);
  gate.completed("good", true);
  expect(gate.isPaused()).toBe(true);
});

test("a refused call's failure does not release a question Codex has not reported", () => {
  const gate = paused();
  gate.started("refused");
  gate.arrived();
  gate.completed("refused", false);
  expect(gate.isPaused()).toBe(true);
});

test("a held call resumes as soon as Codex reports the question failed", async () => {
  const gate = paused(5_000);
  gate.started("retry");
  gate.arrived();
  const held = gate.verdict(true, performance.now());
  gate.completed("question", false);
  await held;
  expect(gate.isPaused()).toBe(false);
});

test("a held call resumes as soon as Codex confirms the question", async () => {
  const gate = paused(5_000);
  const held = gate.verdict(false, performance.now());
  gate.completed("question", true);
  await held;
  expect(gate.isPaused()).toBe(true);
});

test("a held call stops waiting when Codex reports nothing", async () => {
  const gate = paused(5);
  await gate.verdict(false, performance.now());
  expect(gate.isPaused()).toBe(true);
});

test("a call that queued behind another counts its queue time toward the wait", async () => {
  const gate = paused(5_000);
  const startedWaiting = performance.now();
  await gate.verdict(false, startedWaiting - 5_000);
  expect(performance.now() - startedWaiting).toBeLessThan(1_000);
  expect(gate.isPaused()).toBe(true);
});
