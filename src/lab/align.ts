// Which press answers which step. A person who mistypes presses a different key, skips one or presses one twice, so the presses and the
// steps are lined up by edit distance (one point for each key wrong, missing or extra) rather than one-to-one by order.
import type { Press } from "./presses.ts";
import type { Step } from "./intent.ts";

export type Aligned =
  | { kind: "match"; press: Press; step: Step }
  | { kind: "wrong"; press: Press; step: Step }
  | { kind: "extra"; press: Press }
  | { kind: "skipped"; step: Step };

const MATCH = 0;
const WRONG = 1;
const EXTRA = 2;
const SKIP = 3;

export function align(presses: readonly Press[], steps: readonly Step[]): Aligned[] {
  const n = presses.length;
  const m = steps.length;
  const width = m + 1;
  const cost = new Int32Array((n + 1) * width);
  const how = new Uint8Array((n + 1) * width);
  for (let j = 1; j <= m; j++) {
    cost[j] = j;
    how[j] = SKIP;
  }
  for (let i = 1; i <= n; i++) {
    cost[i * width] = i;
    how[i * width] = EXTRA;
  }
  for (let i = 1; i <= n; i++) {
    const press = presses[i - 1] as Press;
    for (let j = 1; j <= m; j++) {
      const hit = (steps[j - 1] as Step).positions.includes(press.position);
      const diagonal = (cost[(i - 1) * width + j - 1] as number) + (hit ? 0 : 1);
      const extra = (cost[(i - 1) * width + j] as number) + 1;
      const skip = (cost[i * width + j - 1] as number) + 1;
      // Ties go to the diagonal, so a mistyped key is a wrong key and not a missing one plus an extra one.
      let best = diagonal;
      let choice = hit ? MATCH : WRONG;
      if (extra < best) {
        best = extra;
        choice = EXTRA;
      }
      if (skip < best) {
        best = skip;
        choice = SKIP;
      }
      cost[i * width + j] = best;
      how[i * width + j] = choice;
    }
  }
  const out: Aligned[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const choice = how[i * width + j] as number;
    if (choice === MATCH || choice === WRONG) {
      out.push({ kind: choice === MATCH ? "match" : "wrong", press: presses[i - 1] as Press, step: steps[j - 1] as Step });
      i--;
      j--;
    } else if (choice === EXTRA) {
      out.push({ kind: "extra", press: presses[i - 1] as Press });
      i--;
    } else {
      out.push({ kind: "skipped", step: steps[j - 1] as Step });
      j--;
    }
  }
  return out.reverse();
}
