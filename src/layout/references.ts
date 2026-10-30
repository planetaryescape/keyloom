// The typed references a reply may name (D-468), read by the page and by the terminal. One family, the same shape the board review
// writes (src/validation/review-item.ts): `{config:<config id>}`, `{proposal:<change set id>}`, `{layer:<layer id>}` and
// `{key:<layer id>:<position>}`. A marker carries an id and nothing else, so a client draws the name only when something live answers
// to that id and writes words when nothing does; model text never becomes a link, an href, HTML or a scheme (D-404). The stored text
// keeps its markers, so an older client reading the same message shows the marker itself (D-468). Nothing here does I/O.
//
// It sits in src/layout because it is a pure text convention three layers read: src/app resolves it for the CLI, src/web draws it, and
// src/cli reaches it through src/app (01#modules). Nothing in the layout model depends on it.
export type Reference =
  | { kind: "config"; id: string }
  | { kind: "proposal"; id: string }
  | { kind: "layer"; layerId: string }
  | { kind: "key"; layerId: string; position: number };

/** A reply's text, in the order it reads: words, then a reference, then words. */
export type ReferencePart = { kind: "words"; text: string } | { kind: "reference"; reference: Reference };

// An id is one token: no spaces, no braces, no further colons beyond the key's position. So `{layer: Base}` and `{screen:history}` are
// not markers at all and stay exactly as the model wrote them, which is what makes a model that invents a kind harmless.
const MARKER = /\{(config|proposal|layer|key):([A-Za-z0-9][A-Za-z0-9._-]*)(?::(\d+))?\}/y;
// Real ids are ~30 characters (`lay_<ULID>`). A longer one is prose that happens to have braces in it, so it stays literal.
const MAX_ID = 64;

/**
 * A marker starting exactly at `at`, and how long it is. The sticky pattern is one shared instance, re-pointed at every call: every
 * caller is plain synchronous scanning with no `await` between calls, so no two reads can interleave.
 */
export function markerAt(text: string, at: number): { reference: Reference; length: number } | null {
  MARKER.lastIndex = at;
  const found = MARKER.exec(text);
  if (found === null) return null;
  const kind = found[1] ?? "";
  const id = found[2] ?? "";
  const position = found[3];
  if (id.length > MAX_ID) return null;
  // A position belongs to a key and to nothing else: `{config:lay_a:3}` and `{layer:base:3}` name nothing, so they read as the text
  // they are. That is also what keeps a version suffix or a clock time in a reply from becoming a reference.
  const reference: Reference | null =
    kind === "key"
      ? (position === undefined ? null : { kind: "key", layerId: id, position: Number(position) })
      : position !== undefined ? null
        : kind === "config" ? { kind: "config", id }
          : kind === "proposal" ? { kind: "proposal", id }
            : { kind: "layer", layerId: id };
  return reference === null ? null : { reference, length: found[0].length };
}

/**
 * Every reference in a text, in order, with the words around them; a marker that names nothing is left in the words. A `code span` is
 * code everywhere a reply is read — the page, the terminal's stream and this scan — so a marker inside backticks stays text here too,
 * and no command is printed for it.
 */
export function referenceParts(text: string): ReferencePart[] {
  const parts: ReferencePart[] = [];
  let words = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      // A span with something in it is code; a lone backtick is just a character, as the page reads it.
      if (close > i + 1) {
        words += text.slice(i, close + 1);
        i = close + 1;
        continue;
      }
    }
    const marker = text[i] === "{" ? markerAt(text, i) : null;
    if (marker === null) {
      words += text[i];
      i += 1;
      continue;
    }
    if (words !== "") parts.push({ kind: "words", text: words });
    words = "";
    parts.push({ kind: "reference", reference: marker.reference });
    i += marker.length;
  }
  if (words !== "") parts.push({ kind: "words", text: words });
  return parts;
}

/** The marker as the model wrote it, for a client that draws no reference at all. */
export function markerText(reference: Reference): string {
  return reference.kind === "config" ? `{config:${reference.id}}`
    : reference.kind === "proposal" ? `{proposal:${reference.id}}`
      : reference.kind === "layer" ? `{layer:${reference.layerId}}`
        : `{key:${reference.layerId}:${reference.position}}`;
}

/** Where a proposal stands; the words a reply uses when it is no longer waiting. */
export type ReferenceStatus = "proposed" | "applied" | "rejected" | "superseded";

/**
 * What a client knows about the things a marker can name. The page answers from what it has on screen and the terminal from the
 * database, so both read a marker the same way: a name when the thing is live, words when it is not.
 */
export type ReferenceWorld = {
  /** The layer's name and how many keys it has, when the layout this reply is about has it. */
  layer(layerId: string): { name: string; keyCount: number } | undefined;
  /** What a key prints on that layer, when the layer and the position exist. */
  keyTap(layerId: string, position: number): string | undefined;
  /** A config's name while it is live: not deleted, not archived. */
  config(id: string): string | undefined;
  /** A proposal this conversation holds, with its title and where it stands. */
  proposal(id: string): { title: string; status: ReferenceStatus } | undefined;
};

export type ReferenceTarget =
  | { kind: "config"; id: string; label: string }
  | { kind: "proposal"; id: string; label: string }
  | { kind: "layer"; layerId: string; label: string }
  | { kind: "key"; layerId: string; position: number; label: string; layerName: string };

/** A reference that can be gone to, or the words it stands for when nothing live answers to it. */
export type ReferenceRead = { kind: "target"; target: ReferenceTarget } | { kind: "words"; text: string };

const words = (text: string): ReferenceRead => ({ kind: "words", text });

/**
 * One marker read against what the client has: a chip or a link for something live, and plain words otherwise. A proposal that is no
 * longer waiting reads as its title with where it stands (D-468): it is a fact about the change, not a thing to open. A marker whose
 * id belongs to nothing keeps the id as words, which is the only name left for it.
 */
export function readReference(reference: Reference, world: ReferenceWorld): ReferenceRead {
  switch (reference.kind) {
    case "config": {
      const name = world.config(reference.id);
      return name === undefined ? words(reference.id) : { kind: "target", target: { kind: "config", id: reference.id, label: name } };
    }
    case "proposal": {
      const found = world.proposal(reference.id);
      if (found === undefined) return words(reference.id);
      if (found.status !== "proposed") return words(`${found.title} (${found.status})`);
      return { kind: "target", target: { kind: "proposal", id: reference.id, label: found.title } };
    }
    case "layer": {
      const layer = world.layer(reference.layerId);
      return layer === undefined ? words(reference.layerId) : { kind: "target", target: { kind: "layer", layerId: reference.layerId, label: layer.name } };
    }
    case "key": {
      const layer = world.layer(reference.layerId);
      // A key is only a place on a layer: with the layer gone, or the position past its keys, the marker names no key.
      if (layer === undefined) return words(reference.layerId);
      if (reference.position >= layer.keyCount) return words(`key ${reference.position + 1} on ${layer.name}`);
      const tap = world.keyTap(reference.layerId, reference.position);
      return { kind: "target", target: { kind: "key", layerId: reference.layerId, position: reference.position, label: tap === undefined || tap === "" ? "empty key" : tap, layerName: layer.name } };
    }
  }
}
