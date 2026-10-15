// Every field a board.json can hold, as dotted paths (`revisions[].build.image`), read from the zod schema so
// the guide can't drift from it. Arrays add `[]`; records (`fingers`, `rows`, `mirror`) are one field, not one per key.
import type { z } from "zod";

type Def = { type: string; shape?: Record<string, z.ZodType>; element?: z.ZodType; innerType?: z.ZodType; options?: z.ZodType[] };
const defOf = (s: z.ZodType): Def => (s as unknown as { _zod: { def: Def } })._zod.def;

export function schemaPaths(schema: z.ZodType, prefix = ""): string[] {
  const def = defOf(schema);
  switch (def.type) {
    case "object":
      return Object.entries(def.shape ?? {}).flatMap(([key, child]) => {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        const inner = schemaPaths(child, path);
        return inner.length === 0 ? [path] : [path, ...inner];
      });
    case "array":
      return schemaPaths(def.element as z.ZodType, `${prefix}[]`);
    case "optional":
    case "nullable":
    case "default":
      return schemaPaths(def.innerType as z.ZodType, prefix);
    case "union":
      return [...new Set((def.options ?? []).flatMap((o) => schemaPaths(o, prefix)))];
    default:
      return [];
  }
}
