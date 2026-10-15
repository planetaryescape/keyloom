// The inside of a `<...>` cell array as behaviour calls: `&hm LGUI F` is { name: "hm", params: ["LGUI", "F"] }.
// Parameters are kept as written (`LC(LS(A))`, `(-1)`, `LOWER`); interpreting them is bindings.ts's job.

export type BehaviorCall = { name: string; params: string[] };

/** Splits on whitespace outside parentheses, so `LC(LS(A))` and `(A)` stay whole. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  const push = () => {
    if (cur !== "") out.push(cur);
    cur = "";
  };
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) push();
    else if (ch === "&" && depth === 0) {
      push();
      cur = "&";
    } else cur += ch;
  }
  push();
  return out;
}

/**
 * Behaviour calls in order. Anything before the first `&` is not a binding (it is returned as
 * `leading`), which is how a plain integer array such as `<0 1 2>` is read with the same tokenizer.
 */
export function parseCalls(text: string): { calls: BehaviorCall[]; leading: string[] } {
  const calls: BehaviorCall[] = [];
  const leading: string[] = [];
  for (const t of tokens(text)) {
    if (t.startsWith("&")) calls.push({ name: t.slice(1), params: [] });
    else (calls.at(-1)?.params ?? leading).push(t);
  }
  return { calls, leading };
}

export const callText = (c: BehaviorCall): string => [`&${c.name}`, ...c.params].join(" ");
