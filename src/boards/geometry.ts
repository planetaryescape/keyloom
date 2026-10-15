// Generates geometry.json from the pinned firmware tree (D-045). Never from memory or a copy:
// the file is derived, and `boards check` regenerates it to catch drift.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type BoardDefinition, type BoardRevision, type Geometry, GeometrySchema } from "./schema.ts";

export type TextFetcher = (url: string) => Promise<string>;

export class GeometryError extends Error {
  override name = "GeometryError";
}

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

export function geometryPath(rev: BoardRevision): string {
  if (!rev.qmkTarget) throw new GeometryError(`revision ${rev.id} has no qmkTarget`);
  return `keyboards/${rev.qmkTarget}/keyboard.json`;
}

/** Fetches a file at an immutable SHA. SHAs never change, so a cached copy is always valid. */
async function fetchPinned(
  rev: BoardRevision,
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
  if (board.firmware !== "qmk") {
    throw new GeometryError(`geometry generation for ${board.firmware} boards is not implemented yet`);
  }
  const path = geometryPath(rev);
  const text = await fetchPinned(rev, path, opts.fetchText ?? defaultFetcher, opts.cacheDir);
  let doc: { layouts?: Record<string, { layout?: QmkKey[] }> };
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new GeometryError(`${path} at ${rev.source.sha} is not valid JSON: ${(err as Error).message}`);
  }
  const layouts = doc.layouts ?? {};
  // Boards with several layout macros (Moonlander also has LAYOUT_halfmoon) use the canonical one.
  const names = Object.keys(layouts);
  const name = names.length === 1 ? names[0] : names.find((n) => n === "LAYOUT");
  const layout = name ? layouts[name]?.layout : undefined;
  if (!layout) throw new GeometryError(`${path} has no layout named LAYOUT (found: ${names.join(", ") || "none"})`);
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
