import { basename } from "node:path";
import index from "../web/index.html";

// The app shell and everything it loads, keyed by URL path. Bun serves an HTML import only
// as a route, and routes are matched before `fetch`, so the Host check would not run for
// them. The server serves these itself instead.
export interface WebAsset {
  file: Blob;
  type: string;
}
export type WebAssets = ReadonlyMap<string, WebAsset>;

let loaded: Promise<WebAssets> | undefined;

// Loaded on the first asset request, after the Host check, so startServer stays synchronous.
export async function loadWebAssets(): Promise<WebAssets> {
  try {
    return await (loaded ??= build());
  } catch (error) {
    // A failed build is retried on the next request rather than cached.
    loaded = undefined;
    throw error;
  }
}

async function build(): Promise<WebAssets> {
  // A compiled binary embeds the bundle and lists its files. Under `bun run` and `bun test`
  // the list is absent, so the bundle is built in memory from the entry point.
  if (index.files !== undefined) return withFaviconIco(fromEmbeddedFiles(index.files));
  return withFaviconIco(await fromInMemoryBuild(index.index));
}

// index.html links the icon under its bundled, hashed name. Pages that aren't the app (the 404 page, a browser that asks before it
// reads the HTML) still ask for /favicon.ico, so that path answers with the same icon instead of a 404.
export function withFaviconIco(assets: Map<string, WebAsset>): Map<string, WebAsset> {
  const icon = [...assets].find(([path]) => /^\/favicon(-[\w]+)?\.png$/.test(path));
  if (icon !== undefined && !assets.has("/favicon.ico")) assets.set("/favicon.ico", icon[1]);
  return assets;
}

function fromEmbeddedFiles(files: NonNullable<typeof index.files>): Map<string, WebAsset> {
  const assets = new Map<string, WebAsset>();
  for (const file of files) {
    const key = file.loader === "html" ? "/" : `/${basename(file.path)}`;
    const blob = Bun.file(file.path);
    assets.set(key, { file: blob, type: blob.type });
  }
  return assets;
}

async function fromInMemoryBuild(entry: string): Promise<Map<string, WebAsset>> {
  const result = await Bun.build({ entrypoints: [entry], target: "browser", minify: true });
  if (!result.success) {
    throw new Error(`web bundle failed:\n${result.logs.map(String).join("\n")}`);
  }
  const assets = new Map<string, WebAsset>();
  for (const output of result.outputs) {
    const key = output.type.startsWith("text/html") ? "/" : `/${basename(output.path)}`;
    assets.set(key, { file: output, type: output.type });
  }
  return assets;
}
