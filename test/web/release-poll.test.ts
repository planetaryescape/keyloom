// The release dialog's poll (R2-13): after three misses it says keyloom stopped answering, keeps asking, and clears the line itself
// when keyloom answers again.
import { expect, test } from "bun:test";
import { poll } from "../../src/web/release/useRelease.ts";

test("a poll that lost keyloom keeps asking, and says so once, then clears when it answers", async () => {
  const answers = [false, false, false, false, true, true];
  let asked = 0;
  const events: string[] = [];
  const done = Promise.withResolvers<void>();
  const stop = poll(
    async () => {
      const ok = answers[asked++] ?? true;
      if (!ok) throw new Error("unreachable");
      return asked;
    },
    (value) => events.push(`publish ${value}`),
    (value) => {
      if (value >= 6) done.resolve();
      return value >= 6;
    },
    () => events.push("lost"),
    () => events.push("found"),
    1,
  );
  await done.promise;
  stop();
  expect(events).toEqual(["lost", "found", "publish 5", "publish 6"]);
});
