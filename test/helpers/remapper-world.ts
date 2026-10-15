// The MacBook board, a layout on it, a fake kanata on a loopback port and a sync engine over them: the apply, verify and
// disable flows of the remapper without kanata, a driver or root. The home folder is a temporary one, never the real one.
import { openApp } from "../../src/app/index.ts";
import type { SyncDeps } from "../../src/app/sync-deps.ts";
import { appSyncDeps } from "../../src/app/sync-deps.ts";
import { SyncEngine, type SyncOptions } from "../../src/app/sync-engine.ts";
import { remapperReading } from "../../src/app/sync-keyboard.ts";
import { identityLayout } from "../../src/firmware/kanata/identity.ts";
import { remapperPaths } from "../../src/firmware/kanata/paths.ts";
import { createLayout } from "../../src/persistence/layouts.ts";
import { recordHandsFreeProof } from "../../src/persistence/syncs.ts";
import { startFakeKanata } from "./fake-kanata.ts";
import { macbook, richLayout } from "./macbook.ts";
import { tempDir } from "./tmp.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SETUP_REVISION, generateKanataSource } from "../../src/firmware/kanata/generate.ts";

export const MAC = "apple/macbook-ansi";

export function remapperWorld(opts: { proven?: boolean } = {}) {
  const home = tempDir();
  const app = openApp({ dataDir: tempDir() });
  // As after `keyloom remap setup`: the daemon started on keyloom's identity file.
  const paths = remapperPaths(home);
  const setupSource = generateKanataSource({ layout: identityLayout(macbook()), board: macbook(), layoutId: "none", revisionId: SETUP_REVISION });
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.kbd, setupSource.files[0]!.content);
  writeFileSync(paths.safe, setupSource.files[1]!.content);
  const fake = startFakeKanata({ initialFile: paths.kbd });
  const over = {
    home, endpoint: { port: fake.port },
    // kanata isn't needed for the state machine: the file only has to exist and be keyloom's.
    check: async (p: string) => ({ ok: readFileSync(p, "utf8").includes("(deflayer"), output: "config file is valid" }),
  };
  const created = createLayout(app.db, { name: "macbook", layout: identityLayout(macbook()), summary: "identity", origin: "import" });
  if (opts.proven) recordHandsFreeProof(app.db, MAC, "exit-chord");
  const real = appSyncDeps(app, { handsFree: { remapper: over } });
  const deps: SyncDeps = {
    remapper: real.remapper!,
    readKeyboards: async () => new Map([[MAC, await remapperReading(MAC, over)]]),
    build: async () => ({ ok: false, error: "a remapper is not built" }),
    flash: async () => ({ ok: false, error: "a remapper is not flashed" }),
  };
  const engines: SyncEngine[] = [];
  return {
    app, fake, home, over, deps, layoutId: created.layout.id, paths,
    richLayoutId: () => createLayout(app.db, { name: "rich", layout: richLayout(), summary: "rich", origin: "import" }).layout.id,
    engine(o: SyncOptions = {}) {
      const e = new SyncEngine(app, deps, { quietMs: 5, tickMs: 600_000, pollMs: 0, ...o });
      engines.push(e);
      return e;
    },
    async stopAll() {
      for (const e of engines) await e.stop({ flashGraceMs: 50 });
      fake.stop();
    },
  };
}
