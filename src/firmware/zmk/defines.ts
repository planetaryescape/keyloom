// The part of the C preprocessor a keymap's own `#define`s need: `#define HYPER LC(LS(LG(LALT)))` and
// `#define LOWER 1` used as binding parameters. Object-like defines are expanded; function-like ones
// are not, so a binding that uses one stays native. #include is not followed: the key names those
// headers define are already in the keycode table (D-044), and following them would make import
// depend on a firmware checkout that may not exist yet (06 says the include tree comes from the
// pinned checkout; this deliberately does not, so `keyloom import` works offline and before a first build).

export type Defines = ReadonlyMap<string, string>;

const IDENT = /[A-Za-z_]\w*/g;
const MAX_DEPTH = 8;

/** Replaces every identifier that is an object-like define by its body, repeatedly, until nothing changes or it loops. */
export function expand(text: string, defines: Defines): string {
  let cur = text;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const next = cur.replace(IDENT, (id) => defines.get(id) ?? id);
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

/** `3`, `(3)`, `(-1)`, `0x10` after expansion; undefined for anything that is not one plain integer. */
export function evalInt(text: string, defines: Defines): number | undefined {
  let cur = expand(text, defines).trim();
  while (/^\(.*\)$/s.test(cur)) cur = cur.slice(1, -1).trim();
  if (!/^-?(0x[0-9a-f]+|\d+)$/i.test(cur)) return undefined;
  const n = Number(cur);
  return Number.isSafeInteger(n) ? n : undefined;
}
