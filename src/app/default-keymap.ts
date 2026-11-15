// The firmware's own default keymap for a board (25, D-370): the starting point of a blank config where keyloom can get one. It is read
// from the board's pinned firmware tree the way `boards geometry` reads the layout (fetched once, cached by SHA), then through the
// importer for its firmware, so a default is exactly what importing that file would give. Nothing here is required: no default is a reason, not an error.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type GeometryOptions, defaultFetcher, fetchPinned } from "../boards/geometry.ts";
import type { BoardDefinition, BoardRevision } from "../boards/schema.ts";
import { ImportError, importOryxSource } from "../firmware/qmk/import.ts";
import { ZmkImportError, importZmkSource } from "../firmware/zmk/import.ts";
import type { Layout } from "../layout/schema.ts";
import { cacheDir } from "../persistence/paths.ts";

export type DefaultKeymap = { layout: Layout; /** Where it came from, for the revision's summary: `keyboards/zsa/moonlander/keymaps/default at 93b2b9e`. */ from: string } | { layout: null; reason: string };

type Candidate = { files: string[]; repo: string; sha: string };

/** The files a board's default keymap could be in, best first, or why keyloom has no idea where to look. */
function candidates(rev: BoardRevision): Candidate[] | string {
  const build = rev.build;
  if (build.kind === "qmk-docker") {
    const dir = `${build.keymapsDir.replace(/\/$/, "")}/default`;
    return [{ files: [`${dir}/keymap.c`, `${dir}/keymap.json`], repo: rev.source.repo, sha: rev.source.sha }];
  }
  if (build.kind === "zmk-west-docker") {
    return [{ files: [`app/boards/shields/${build.keymapName}/${build.keymapName}.keymap`], repo: rev.source.repo, sha: rev.source.sha }];
  }
  if (build.kind === "zmk-moergo-template") {
    // MoErgo's template is what the board builds from, and its keymap is the Layout Editor's default.
    return [{ files: ["config/glove80.keymap"], repo: build.template.repo, sha: build.template.sha }];
  }
  return "a software remapper starts from the identity map";
}

const short = (sha: string) => sha.slice(0, 7);

export async function readDefaultKeymap(def: BoardDefinition, opts: GeometryOptions = {}): Promise<DefaultKeymap> {
  const rev = def.revisions[0];
  if (rev === undefined) return { layout: null, reason: `${def.name} has no firmware revision` };
  const where = candidates(rev);
  if (typeof where === "string") return { layout: null, reason: where };
  const fetchText = opts.fetchText ?? defaultFetcher;
  const cache = opts.cacheDir ?? join(cacheDir(), "keymaps");
  const problems: string[] = [];
  for (const c of where) {
    for (const file of c.files) {
      let text: string;
      try {
        text = await fetchPinned({ source: { repo: c.repo, ref: "pinned", sha: c.sha } }, file, fetchText, cache);
      } catch (err) {
        problems.push(`${file} at ${short(c.sha)}: ${(err as Error).message}`);
        continue;
      }
      // The importers read paths, so the text goes to a private folder first; the file's own name tells QMK's reader what it is.
      const dir = await mkdtemp(join(tmpdir(), "keyloom-default-keymap-"));
      try {
        const name = file.split("/").at(-1) as string;
        const path = join(dir, name);
        await writeFile(path, text);
        if (def.firmware === "qmk" && name === "keymap.c") {
          // These files can enable VIA or modules that the keymap's callbacks require.
          const companions = await Promise.allSettled(["config.h", "rules.mk", "keymap.json"].map(async (companion) => {
            let source: string;
            try {
              source = await fetchPinned({ source: { repo: c.repo, ref: "pinned", sha: c.sha } }, `${dirname(file)}/${companion}`, fetchText, cache);
            } catch (err) {
              if (err instanceof Error && /returned 404\b/.test(err.message)) return;
              throw new ImportError(`couldn't read ${companion} beside ${file}: ${err instanceof Error ? err.message : String(err)}`);
            }
            await writeFile(join(dir, companion), source);
          }));
          // A JSON fallback cannot replace a C default whose required build files failed to download.
          const failed = companions.find((result) => result.status === "rejected");
          if (failed?.status === "rejected") return {
            layout: null,
            reason: `couldn't get ${def.name}'s default keymap (${file} at ${short(c.sha)}: ${failed.reason instanceof Error ? failed.reason.message : String(failed.reason)})`,
          };
        }
        const imported = def.firmware === "zmk" ? await importZmkSource(path, def) : await importOryxSource(dir, def);
        return { layout: imported.layout, from: `${file} at ${short(c.sha)}` };
      } catch (err) {
        if (!(err instanceof ImportError || err instanceof ZmkImportError)) throw err;
        problems.push(`${file} at ${short(c.sha)} can't be read as this board's keymap: ${err.message}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }
  return { layout: null, reason: `couldn't get ${def.name}'s default keymap (${problems.join("; ")})` };
}
