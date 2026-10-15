// `keyloom doctor` (10): the database, then the firmware toolchain.
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { qmkRevision } from "../firmware/qmk/board-config.ts";
import { type CheckoutSpec, checkoutState } from "../firmware/toolchain/checkout.ts";
import { LOW_DISK_BYTES, dockerFreeSpace, dockerStatus } from "../firmware/toolchain/docker.ts";
import { capture } from "../firmware/toolchain/run.ts";
import { MIGRATIONS } from "../persistence/migrations.ts";
import { databasePath, dataDir as resolveDataDir } from "../persistence/paths.ts";
import { listBoardDefinitions } from "./boards.ts";
import { checkoutDirFor } from "./firmware.ts";

/** `warn` marks a check that passed but needs attention; it doesn't fail `doctor`. */
export type DoctorCheck = { name: string; ok: boolean; detail: string; warn?: boolean };

export function runDoctor(opts: { dataDir?: string } = {}): DoctorCheck[] {
  const dir = resolveDataDir(opts.dataDir);
  const file = databasePath(dir);
  const checks: DoctorCheck[] = [{ name: "data directory", ok: true, detail: dir }];
  if (!existsSync(file)) {
    checks.push({ name: "database", ok: true, detail: `${file} does not exist yet; it is created by the first import` });
    return checks;
  }
  // Read-only: doctor must not create or migrate anything.
  let db: Database | undefined;
  try {
    db = new Database(file, { readonly: true, strict: true });
    const integrity = (db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    checks.push({ name: "database integrity", ok: integrity === "ok", detail: integrity });
    const mode = (db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
    checks.push({ name: "journal mode", ok: mode === "wal", detail: mode });
    const row = db.query("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
    const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
    checks.push({
      name: "migrations",
      ok: row.v === latest,
      detail: row.v === latest ? `at version ${latest}` : `database is at ${row.v ?? "none"}, this keyloom expects ${latest}`,
    });
    const layouts = db.query("SELECT COUNT(*) AS n FROM layouts").get() as { n: number };
    checks.push({ name: "layouts", ok: true, detail: String(layouts.n) });
  } catch (err) {
    checks.push({ name: "database", ok: false, detail: (err as Error).message });
  } finally {
    db?.close();
  }
  return checks;
}

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** Docker, its disk, Zapp and the pinned checkouts. A missing Zapp is a warning: building works without it. */
export async function runToolchainChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const docker = await dockerStatus();
  checks.push({ name: "docker", ok: docker.ok, detail: docker.ok ? `running, server ${docker.version}` : docker.reason });

  const qmkBoards = listBoardDefinitions().filter((b) => b.definition.firmware === "qmk");
  const images = [...new Set(qmkBoards.flatMap((b) => b.definition.revisions.map((r) => (r.build as { image?: string }).image)).filter((i): i is string => typeof i === "string"))];

  if (docker.ok) {
    const disk = await dockerFreeSpace(["alpine", ...images]);
    if ("unknown" in disk) {
      checks.push({ name: "docker disk", ok: true, detail: disk.unknown });
    } else {
      const low = disk.freeBytes < LOW_DISK_BYTES;
      checks.push({
        name: "docker disk",
        ok: true,
        ...(low ? { warn: true } : {}),
        detail: low ? `${gb(disk.freeBytes)} free in Docker's disk; builds can fail under ${gb(LOW_DISK_BYTES)}. Run \`docker builder prune\` or raise the limit` : `${gb(disk.freeBytes)} free in Docker's disk`,
      });
    }
    for (const image of images) {
      const present = (await capture(["docker", "image", "inspect", image], { timeoutMs: 15_000 })).exitCode === 0;
      checks.push({ name: "build image", ok: true, detail: present ? `${image.split("@")[0]} is pulled` : `${image.split("@")[0]} is not pulled yet; the first build downloads it` });
    }
  }

  const zapp = Bun.which("zapp");
  checks.push({
    name: "zapp",
    ok: true,
    ...(zapp ? {} : { warn: true }),
    detail: zapp ?? "not on PATH; install it with `brew install zapp` to flash from keyloom",
  });

  for (const board of qmkBoards) {
    const rev = board.definition.revisions[0];
    if (!rev) continue;
    const q = qmkRevision(board.definition, rev.id);
    const spec: CheckoutSpec = { dir: checkoutDirFor(board), repo: q.source.repo, sha: q.source.sha, submodules: q.build.submodules };
    const name = `checkout ${board.definition.id}`;
    try {
      const state = await checkoutState(spec);
      if (!state.present) checks.push({ name, ok: true, detail: `${spec.dir} doesn't exist yet; the first build creates it` });
      else if (!state.pinned) checks.push({ name, ok: false, detail: `${spec.dir} is at ${state.head}, not the pinned ${spec.sha}; delete it and keyloom recreates it` });
      else if (state.drifted.length > 0) checks.push({ name, ok: false, detail: `submodules ${state.drifted.join(", ")} are not at the pinned commits; delete ${spec.dir}` });
      else if (state.uninitialised.length > 0) checks.push({ name, ok: true, warn: true, detail: `pinned at ${spec.sha.slice(0, 9)}; submodules ${state.uninitialised.join(", ")} will be fetched by the next build` });
      else checks.push({ name, ok: true, detail: `pinned at ${spec.sha.slice(0, 9)} (${spec.dir})` });
    } catch (err) {
      checks.push({ name, ok: false, detail: (err as Error).message });
    }
  }
  return checks;
}
