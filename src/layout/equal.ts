// Structural equality for layout JSON. src/layout can't use bun:test or node:util, and the
// browser has no built-in deep compare, so this covers exactly what a Layout holds: plain
// objects, arrays and primitives.

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  // An absent optional field and an explicit undefined are the same document once serialised.
  if (keys.length !== Object.keys(bo).filter((k) => bo[k] !== undefined).length) return false;
  return keys.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
}
