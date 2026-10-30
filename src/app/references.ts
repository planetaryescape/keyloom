// A reply's typed references as the terminal reads them (D-468). The page draws a chip per marker from the data it already has on
// screen; the terminal has no board to draw on, so it writes the name the marker stands for while the reply streams and, once the
// reply is whole, the command that reaches each config and proposal it named. Reading only: nothing here writes, reloads or reruns.
import { type Reference, type ReferenceRead, type ReferenceStatus, type ReferenceWorld, readReference, referenceParts } from "../layout/references.ts";
import { legendWords } from "../boards/key-names.ts";
import { layerDisplayName } from "../layout/cap-words.ts";
import { bindingLegend } from "../layout/legend.ts";
import { listConversationChangeSets } from "../persistence/change-sets.ts";
import { type App } from "./context.ts";
import { listConfigs } from "./configs.ts";
import { getLayout } from "./layouts.ts";

/**
 * What the config this reply is about, its config list and its conversation can name. Read lazily and once each: a reply's markers
 * are resolved against the layout as it stood when the turn started, while a proposal saved by the turn itself is looked up fresh,
 * because it exists only once `propose_changes` has run.
 */
function worldOf(app: App, layoutRef: string, conversationId: () => string | undefined): ReferenceWorld {
  let layout: ReturnType<typeof getLayout> | null = null;
  let configs: ReadonlyMap<string, string> | null = null;
  const document = () => {
    layout ??= getLayout(app, layoutRef);
    return layout.document;
  };
  const layerOf = (layerId: string) => document().layers.find((layer) => layer.id === layerId);
  return {
    layer: (layerId) => {
      const layer = layerOf(layerId);
      return layer === undefined ? undefined : { name: layerDisplayName(layer.name), keyCount: layer.bindings.length };
    },
    keyTap: (layerId, position) => {
      const layer = layerOf(layerId);
      const binding = layer?.bindings[position];
      return binding === undefined ? undefined : legendWords(bindingLegend(binding, { layers: document().layers, macros: document().macros, tapDances: document().tapDances }));
    },
    config: (id) => {
      // The list is read once and re-read only when a marker names something it did not have: a reply that streams `{config:<id>}` after
      // `create_config` or `put_config` in the same turn has to find the config that turn just made.
      const known = configs?.get(id);
      if (known !== undefined) return known;
      configs = new Map(listConfigs(app).filter((config) => config.archivedAt === null).map((config) => [config.id, config.name]));
      return configs.get(id);
    },
    proposal: (id) => {
      const conversation = conversationId();
      if (conversation === undefined) return undefined;
      const row = listConversationChangeSets(app.db, conversation).find((change) => change.id === id);
      if (row === undefined) return undefined;
      // The card's fallback title, so the terminal and the card never describe one change differently.
      return { title: row.title ?? row.explanation.slice(0, 80), status: row.status satisfies ReferenceStatus };
    },
  };
}

/**
 * Resolves one marker at a time while a reply streams, in the words the terminal can print: a layer's name, what a key prints, a
 * config's name, a proposal's title. A marker that names nothing live keeps the id it carries, which is the only name left for it.
 */
export function replyReferenceReader(app: App, layoutRef: string, conversationId: () => string | undefined): (reference: Reference) => string {
  const world = worldOf(app, layoutRef, conversationId);
  return (reference) => {
    const read = readReference(reference, world);
    return read.kind === "words" ? read.text : read.target.label;
  };
}

const routeOf = (read: ReferenceRead): string | null => {
  if (read.kind !== "target") return null;
  // The page is the surface for a layer and a key: there is nothing to run in a terminal that would reach them.
  if (read.target.kind === "config") return `to open it: keyloom config use ${read.target.id}`;
  if (read.target.kind === "proposal") return `to review it: keyloom change show ${read.target.id}`;
  return null;
};

/** The commands that reach what a reply named, one per config and per proposal, in the order they were first read. */
export function replyReferenceRoutes(app: App, layoutRef: string, text: string, conversationId: () => string | undefined): string[] {
  const world = worldOf(app, layoutRef, conversationId);
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const part of referenceParts(text)) {
    if (part.kind !== "reference") continue;
    const line = routeOf(readReference(part.reference, world));
    if (line === null || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}
