/** A layer or combo node name as an id: `layer_Base` becomes `layer-base`. Unique within `taken`. */
export function slug(text: string, taken: ReadonlySet<string>): string {
  let base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (base === "") base = "x";
  // Layer ids start with a letter (LayerSchema).
  if (!/^[a-z]/.test(base)) base = `l-${base}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** The devicetree node name an id is written as; the inverse of slug for ids slug made. */
export const nodeNameOf = (id: string): string => id.replaceAll("-", "_");
