// A C keycode expression read from plain text, for code tree-sitter hasn't parsed (the statements
// inside Oryx's tap dance functions). Same Expr shape as c-parse.ts, so mapKey reads both.
import type { Expr } from "./c-parse.ts";

/** Undefined when the text is anything but identifiers, numbers, calls and `|`. */
export function parseExprText(source: string): Expr | undefined {
  let i = 0;
  const skip = () => {
    while (i < source.length && /\s/.test(source[i] as string)) i++;
  };

  const operand = (): Expr | undefined => {
    skip();
    const start = i;
    const word = /^[A-Za-z_][A-Za-z0-9_]*|^\d+/.exec(source.slice(i))?.[0];
    if (!word) return undefined;
    i += word.length;
    skip();
    if (/^\d/.test(word)) return { kind: "num", value: Number(word), text: word };
    if (source[i] !== "(") return { kind: "id", name: word, text: word };
    i++;
    const args: Expr[] = [];
    skip();
    if (source[i] === ")") i++;
    else {
      for (;;) {
        const arg = expression();
        if (!arg) return undefined;
        args.push(arg);
        skip();
        if (source[i] === ",") i++;
        else if (source[i] === ")") {
          i++;
          break;
        } else return undefined;
      }
    }
    return { kind: "call", name: word, args, text: source.slice(start, i).replace(/\s+/g, " ").trim() };
  };

  const expression = (): Expr | undefined => {
    const first = operand();
    if (!first) return undefined;
    const operands = [first];
    skip();
    while (source[i] === "|") {
      i++;
      const next = operand();
      if (!next) return undefined;
      operands.push(next);
      skip();
    }
    return operands.length === 1 ? first : { kind: "or", operands, text: operands.map((o) => o.text).join(" | ") };
  };

  const result = expression();
  skip();
  return result && i === source.length ? result : undefined;
}
