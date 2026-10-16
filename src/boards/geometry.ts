// Generates geometry.json from the pinned firmware tree (D-045). Never from memory or a copy:
// the file is derived, and `boards check` regenerates it to catch drift.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GeometryError } from "./geometry-error.ts";
import { parsePhysicalLayout } from "./zmk-geometry.ts";
import { type BoardDefinition, type BoardRevision, type Geometry, GeometrySchema } from "./schema.ts";

export type TextFetcher = (url: string) => Promise<string>;

export { GeometryError } from "./geometry-error.ts";

export const defaultFetcher: TextFetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new GeometryError(`GET ${url} returned ${res.status}`);
  return res.text();
};

type QmkKey = { x: number; y: number; w?: number; h?: number; r?: number; rx?: number; ry?: number };

function githubSlug(repo: string): string {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repo);
  if (!m?.[1]) throw new GeometryError(`only github.com repos are supported, got ${repo}`);
  return m[1];
}

/** A ZMK board's `physicalLayout` is a file, or `file#label` where the file holds several layouts. */
export const splitLayoutRef = (ref: string): { path: string; label?: string } => {
  const [path = ref, label] = ref.split("#");
  return label === undefined ? { path } : { path, label };
};

export function geometryPath(rev: BoardRevision): string {
  // A ZMK board names the file holding its `zmk,physical-layout`; a QMK board's is derived from its target unless it names one.
  if (rev.build.kind === "kanata-config") throw new GeometryError(`revision ${rev.id}: a software remapper's geometry is written by hand, not derived from a firmware tree`);
  if (rev.build.kind !== "qmk-docker") return rev.build.physicalLayout;
  if (rev.build.layoutFile) return rev.build.layoutFile;
  if (!rev.qmkTarget) throw new GeometryError(`revision ${rev.id} has no qmkTarget`);
  return `keyboards/${rev.qmkTarget}/keyboard.json`;
}

/** Fetches a file at an immutable SHA. SHAs never change, so a cached copy is always valid. */
export async function fetchPinned(
  rev: Pick<BoardRevision, "source">,
  path: string,
  fetchText: TextFetcher,
  cacheDir: string | undefined,
): Promise<string> {
  const cacheFile = cacheDir ? join(cacheDir, rev.source.sha, path) : undefined;
  if (cacheFile) {
    const cached = Bun.file(cacheFile);
    if (await cached.exists()) return cached.text();
  }
  const text = await fetchText(`https://raw.githubusercontent.com/${githubSlug(rev.source.repo)}/${rev.source.sha}/${path}`);
  if (cacheFile) {
    await mkdir(dirname(cacheFile), { recursive: true });
    await Bun.write(cacheFile, text);
  }
  return text;
}

export type GeometryOptions = { fetchText?: TextFetcher; cacheDir?: string | undefined };

/** Geometry for one revision of a QMK board: `layouts.LAYOUT.layout`, in binding order. */
export async function generateGeometry(board: BoardDefinition, rev: BoardRevision, opts: GeometryOptions = {}): Promise<Geometry> {
  if (board.firmware === "kanata") throw new GeometryError(`${board.id} is a software remapper: its geometry.json is written by hand, so there is nothing to regenerate`);
  const ref = geometryPath(rev);
  const { path, label } = splitLayoutRef(ref);
  const text = await fetchPinned(rev, path, opts.fetchText ?? defaultFetcher, opts.cacheDir);
  if (board.firmware === "zmk") {
    const keys = parsePhysicalLayout(text, label);
    if (keys.length !== board.keyCount) throw new GeometryError(`${path} has ${keys.length} keys, board.json says keyCount ${board.keyCount}`);
    return GeometrySchema.parse({ schemaVersion: 1, source: { repo: rev.source.repo, sha: rev.source.sha, path: ref }, keys });
  }
  let doc: { layouts?: Record<string, { layout?: QmkKey[] }>; layout_aliases?: Record<string, string> };
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new GeometryError(`${path} at ${rev.source.sha} is not valid JSON: ${(err as Error).message}`);
  }
  const layouts = doc.layouts ?? {};
  // The layout the keymap is written with: its macro, possibly through an alias (the Moonlander's
  // LAYOUT_moonlander is an alias of LAYOUT, and the file also holds LAYOUT_halfmoon).
  const names = Object.keys(layouts);
  const macro = rev.build.kind === "qmk-docker" ? rev.build.layoutMacro : "LAYOUT";
  const aliased = layouts[macro] ? macro : doc.layout_aliases?.[macro];
  // Without the macro's own layout, a file with one layout, or one called LAYOUT, still has an obvious answer.
  const name = aliased && layouts[aliased] ? aliased : names.length === 1 ? names[0] : names.find((n) => n === "LAYOUT");
  const layout = name ? layouts[name]?.layout : undefined;
  if (!layout) throw new GeometryError(`${path} has no layout named ${macro} or LAYOUT (found: ${names.join(", ") || "none"})`);
  if (layout.length !== board.keyCount) {
    throw new GeometryError(`${path} LAYOUT has ${layout.length} keys, board.json says keyCount ${board.keyCount}`);
  }
  // QMK omits w, h, r, rx and ry when they are 1, 1, 0, 0 and 0.
  return GeometrySchema.parse({
    schemaVersion: 1,
    source: { repo: rev.source.repo, sha: rev.source.sha, path },
    keys: layout.map((k) => ({ x: k.x, y: k.y, w: k.w ?? 1, h: k.h ?? 1, r: k.r ?? 0, rx: k.rx ?? 0, ry: k.ry ?? 0 })),
  });
}

/** One key per line, so a geometry diff in review shows exactly which key moved. */
export function serializeGeometry(g: Geometry): string {
  const head = `  "schemaVersion": ${g.schemaVersion},\n  "source": ${JSON.stringify(g.source)},\n`;
  const keys = g.keys.map((k) => `    ${JSON.stringify(k)}`).join(",\n");
  return `{\n${head}  "keys": [\n${keys}\n  ]\n}\n`;
}
