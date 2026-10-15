// `keyloom doctor` (10): the database, then the firmware toolchain.
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { qmkRevision } from "../firmware/qmk/board-config.ts";
import { zmkRevision } from "../firmware/zmk/board-config.ts";
import { imageTag } from "../firmware/zmk/image.ts";
import { type CheckoutSpec, checkoutState } from "../firmware/toolchain/checkout.ts";
import { LOW_DISK_BYTES, dockerFreeSpace, dockerStatus } from "../firmware/toolchain/docker.ts";
import { capture, which } from "../firmware/toolchain/run.ts";
import { MIGRATIONS } from "../persistence/migrations.ts";
import { databasePath, dataDir as resolveDataDir } from "../persistence/paths.ts";
import { listBoardDefinitions } from "./boards.ts";
import { type HandsFreeDeps, realHandsFreeDeps } from "../firmware/qmk/handsfree-flash.ts";
import { checkoutDirFor } from "./firmware.ts";
import { attachedKeyboards, rawHidFinding } from "./keyboard.ts";

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
  const zmkBoards = listBoardDefinitions().filter((b) => b.definition.firmware === "zmk");
  const images = [...new Set(qmkBoards.flatMap((b) => b.definition.revisions.map((r) => (r.build as { image?: string }).image)).filter((i): i is string => typeof i === "string"))];
  // A ZMK board's image is built by keyloom, named for the firmware ref it holds.
  // A west board names a pulled image; a MoErgo-template board's is built by keyloom.
  const zmkBuilds = zmkBoards.map((b) => ({ board: b, rev: zmkRevision(b.definition) }));
  const zmkImages = [...new Set(zmkBuilds.map(({ rev }) => (rev.build.kind === "zmk-west-docker" ? rev.build.image : imageTag(rev.source.sha))))];

  if (docker.ok) {
    const disk = await dockerFreeSpace(["alpine", ...images, ...zmkImages]);
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
    for (const image of zmkImages) {
      const present = (await capture(["docker", "image", "inspect", image], { timeoutMs: 15_000 })).exitCode === 0;
      checks.push({ name: "firmware image", ok: true, detail: present ? image.includes("@") ? `${image.split("@")[0]} is pulled` : `${image} is built` : image.includes("@") ? `${image.split("@")[0]} is not pulled yet; the first build downloads it` : `${image} is not built yet; the first Glove80 build makes it (a few minutes, about 5 GB)` });
    }
  }

  const zapp = which("zapp");
  checks.push({
    name: "zapp",
    ok: true,
    ...(zapp ? {} : { warn: true }),
    detail: zapp ?? "not on PATH; install it with `brew install zapp` to flash from keyloom",
  });

  const specs: Array<{ board: string; spec: CheckoutSpec }> = [
    ...qmkBoards.flatMap((board) => {
      const rev = board.definition.revisions[0];
      if (!rev) return [];
      const q = qmkRevision(board.definition, rev.id);
      return [{ board: board.definition.id, spec: { dir: checkoutDirFor(board), repo: q.source.repo, sha: q.source.sha, submodules: q.build.submodules } }];
    }),
    // A ZMK board builds from MoErgo's template repository; the firmware itself is inside the image.
    ...zmkBuilds.flatMap(({ board, rev }) =>
      rev.build.kind === "zmk-moergo-template"
        ? [{ board: board.definition.id, spec: { dir: checkoutDirFor(board), repo: rev.build.template.repo, sha: rev.build.template.sha, submodules: [] } }]
        : [], // a west board's folder is not a git checkout; west fills it
    ),
  ];
  for (const { board, spec } of specs) {
    const name = `checkout ${board}`;
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

/** Which keyboards are attached and whether keyloom's own firmware is on them, which decides if a flash needs a keypress. */
export async function runKeyboardChecks(over: Partial<HandsFreeDeps> = {}): Promise<DoctorCheck[]> {
  const deps = realHandsFreeDeps(over);
  let attached: Awaited<ReturnType<typeof attachedKeyboards>>;
  try {
    attached = await attachedKeyboards(deps);
  } catch (err) {
    return [{ name: "keyboard", ok: true, warn: true, detail: `couldn't read the USB devices: ${(err as Error).message}` }];
  }
  if (attached.length === 0) return [{ name: "keyboard", ok: true, detail: "no keyboard keyloom can flash is attached" }];
  const checks: DoctorCheck[] = [];
  for (const k of attached) {
    const name = `keyboard ${k.boardId} ${k.revisionId}`;
    if (k.firmware.state === "keyloom") {
      const hid = await rawHidFinding(deps, k);
      checks.push({
        name, ok: true, ...(hid.includes("visible") ? {} : { warn: true }),
        detail: `running keyloom build ${k.firmware.serial}; the next flash needs no keypress (${hid})`,
      });
    } else if (k.firmware.state === "other") {
      checks.push({ name, ok: true, detail: `running firmware keyloom didn't build (USB serial ${k.firmware.serial ?? "unavailable"}); the first flash needs the bootloader key, and flashes after it need none` });
    }
  }
  return checks;
}
