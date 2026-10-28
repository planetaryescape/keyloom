import { WINDOWS_ROADMAP, windowsUnavailable, windowsDevicesUnavailable, WINDOWS_HID_DRIVER_HINT, WINDOWS_COM_DRIVER_HINT, WINDOWS_BUSY_HINT } from "../firmware/toolchain/platform-support.ts";
// `keyloom doctor` (10): the database, the model credential, then the firmware toolchain.
import { existsSync } from "node:fs";
import { deviceHelperDiagnostic, type HelperDiagnostic } from "../firmware/toolchain/device-helper/diagnostics.ts";
import { DeviceTransportError } from "../firmware/toolchain/device-helper/transport-client.ts";
import { Database } from "bun:sqlite";
import { SchemaTooNewError, assertSchemaKnown } from "../persistence/schema-guard.ts";
import { classifyModelError, clientFromEnv, openRouterClientFromEnv } from "../agent/anthropic-model.ts";
import { DEFAULT_MODELS } from "../agent/provider.ts";
import { qmkRevision } from "../firmware/qmk/board-config.ts";
import { BREW_FORMULA, type DfuTool } from "../firmware/qmk/dfu-flash.ts";
import { zmkRevision } from "../firmware/zmk/board-config.ts";
import { imageTag } from "../firmware/zmk/image.ts";
import { type CheckoutSpec, checkoutState } from "../firmware/toolchain/checkout.ts";
import { LOW_DISK_BYTES, dockerFreeSpace, dockerStatus } from "../firmware/toolchain/docker.ts";
import { capture, which } from "../firmware/toolchain/run.ts";
import { MIGRATIONS } from "../persistence/migrations.ts";
import { databasePath, dataDir as resolveDataDir } from "../persistence/paths.ts";
import { listBoardDefinitions } from "./boards.ts";
import { realHandsFreeDeps } from "../firmware/qmk/handsfree-flash.ts";
import { checkoutDirFor } from "./firmware.ts";
import { realZmkHandsFreeDeps } from "../firmware/zmk/handsfree-flash.ts";
import type { HandsFreeOverrides } from "./firmware-drivers.ts";
import { type RemapperOverrides, remapperDoctor } from "./remapper.ts";
import { attachedKeyboards, attachedZmkHalves, rawHidFinding } from "./keyboard.ts";
import { keyedProviders } from "./chat-model.ts";

/** `warn` marks a check that passed but needs attention; it doesn't fail `doctor`. */
export type DoctorCheck = { name: string; ok: boolean; detail: string; warn?: boolean; deviceHelper?: HelperDiagnostic };

/** Pure diagnostics: no discovery, device open, provider request, Docker or remapper probe. */
export async function runDeviceHelperCheck(): Promise<DoctorCheck> {
  const deviceHelper = await deviceHelperDiagnostic();
  const source = !deviceHelper.available && deviceHelper.code === "not_bundled";
  return {
    name: "device helper", ok: deviceHelper.available || source, ...(source ? { warn: true } : {}), deviceHelper,
    detail: deviceHelper.available
      ? `host/helper ${deviceHelper.hostVersion}; protocol ${deviceHelper.protocol}; ${deviceHelper.target}; capabilities [${deviceHelper.capabilities.join(", ")}] (${deviceHelper.capabilities.length === 0 ? "diagnostics only" : deviceHelper.capabilities.includes("hid.open") && deviceHelper.capabilities.includes("serial.open") ? (deviceHelper.target.includes("linux") ? "native Linux candidate; hardware acceptance pending; hidraw needs a udev rule scoped to the keyboard VID/PID; ttyACM needs dialout/uucp group access" : deviceHelper.target.includes("windows") ? "native Windows candidate; hardware acceptance pending; in-box HID/usbser.sys drivers required; busy COM port: close the other serial client" : "native backend in use") : deviceHelper.capabilities.includes("serial.open") ? "native serial candidate; hardware acceptance pending" : "native HID candidate; hardware acceptance pending"})`
      : source
        ? "not bundled in source/dev invocation; build with scripts/build-binaries.ts or install a release"
        : `${deviceHelper.code}${deviceHelper.detail ? ` (${deviceHelper.detail})` : ""}; reinstall this keyloom release; if the private helper cache was changed, remove that release from ${windowsUnavailable() ? "%LOCALAPPDATA%\\keyloom\\device-helper" : "$XDG_CACHE_HOME/keyloom/device-helper"} and retry`,
  };
}

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
    // A database a newer keyloom migrated is refused like everywhere else (D-455), not reported as a failed check.
    assertSchemaKnown(db, file);
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
    try {
      const builds = db.query("SELECT id, status FROM builds ORDER BY started_at DESC, id DESC LIMIT 5").all() as Array<{ id: string; status: string }>;
      if (builds.length > 0) {
        const summary = builds.map((b) => `${b.id.slice(0, 8)}: ${b.status}`).join(", ");
        const failed = builds.some((b) => b.status === "failed");
        checks.push({
          name: "recent builds",
          ok: true,
          warn: failed,
          detail: summary,
        });
      }
    } catch {
      // table might not exist
    }
  } catch (err) {
    if (err instanceof SchemaTooNewError) throw err;
    checks.push({ name: "database", ok: false, detail: (err as Error).message });
  } finally {
    db?.close();
  }
  return checks;
}

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/** The providers whose credential keyloom can check with an API read: the two it has a key for, not Codex's login. */
type KeyedProvider = "anthropic" | "openrouter";

/** What one provider's check found: `rejected` is the credential failing, `unchecked` is not being able to tell. */
export type CredentialOutcome = { status: "ok" } | { status: "rejected" | "unchecked"; reason: string };

/** The credential check's injected parts, in the style of RemapperOverrides, so a test never touches the network. */
export type CredentialOverrides = {
  /** Where the key is read from; the process's own environment by default. */
  env?: Record<string, string | undefined>;
  /** The read that resolves a credential. The real one is the SDK's `models.retrieve`: a read, never a generation. */
  verify?: (provider: KeyedProvider, env: Record<string, string | undefined>) => Promise<CredentialOutcome>;
};

/** One round trip, and short enough that a hung network can't hang `doctor` (11#logs). */
const CREDENTIAL_TIMEOUT_MS = 5_000;

async function verifyCredential(provider: KeyedProvider, env: Record<string, string | undefined>): Promise<CredentialOutcome> {
  const client = provider === "anthropic" ? clientFromEnv(env) : openRouterClientFromEnv(env);
  if (!client) return { status: "unchecked", reason: `${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"} is not set` };
  try {
    await client.models.retrieve(DEFAULT_MODELS[provider], null, { timeout: CREDENTIAL_TIMEOUT_MS, maxRetries: 0 });
    return { status: "ok" };
  } catch (err) {
    const failure = classifyModelError(err, provider);
    // A rejected key is the answer this check exists for. Anything else (no network, a rate limit, a model the account
    // can't see) can't tell a good credential from a bad one, and `doctor` must not fail on a flaky connection.
    if (failure !== null && (failure.kind === "auth" || failure.kind === "permission")) return { status: "rejected", reason: failure.message };
    return { status: "unchecked", reason: failure?.message ?? (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * The model credential (11#logs): one `models.retrieve` read for each provider whose key is set, so a turn isn't
 * spent finding out the key is wrong. No key at all is a warning, not a failure: `doctor` must pass on a machine
 * that chats through Codex or doesn't chat yet.
 */
export async function runCredentialChecks(over: CredentialOverrides = {}): Promise<DoctorCheck[]> {
  const env = over.env ?? process.env;
  const verify = over.verify ?? verifyCredential;
  const keyed = keyedProviders(env).filter((p): p is KeyedProvider => p !== "codex");
  if (keyed.length === 0) {
    return [{
      name: "model credential", ok: true, warn: true,
      detail: "no API key is set; set ANTHROPIC_API_KEY or OPENROUTER_API_KEY, or sign in with `codex login`, for example: op run -- keyloom doctor",
    }];
  }
  const checks: DoctorCheck[] = [];
  for (const provider of keyed) {
    const outcome = await verify(provider, env);
    const name = `model credential (${provider})`;
    if (outcome.status === "ok") checks.push({ name, ok: true, detail: `${DEFAULT_MODELS[provider]} resolves` });
    else if (outcome.status === "rejected") checks.push({ name, ok: false, detail: outcome.reason });
    else checks.push({ name, ok: true, warn: true, detail: `couldn't check: ${outcome.reason}` });
  }
  return checks;
}

/** On Windows the device and toolchain checks report what isn't available yet instead of probing (D-435). */
function unavailableOnWindows(name: string): DoctorCheck {
  return { name, ok: true, warn: true, detail: `not available on Windows yet; see ${WINDOWS_ROADMAP}` };
}

/** Docker, its disk, Zapp and the pinned checkouts. A missing Zapp is a warning: building works without it. */
export async function runToolchainChecks(): Promise<DoctorCheck[]> {
  if (windowsUnavailable()) return [unavailableOnWindows("Docker builds and flashing")];
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

  // The DFU tools a derived board's flash recipe runs (22, D-365). keyloom doesn't install them; a warning names the formula.
  const needed = new Map<DfuTool, string[]>();
  for (const board of qmkBoards) {
    for (const rev of board.definition.revisions) {
      if (rev.flash.kind === "dfu-tool") needed.set(rev.flash.tool, [...(needed.get(rev.flash.tool) ?? []), board.definition.name]);
    }
  }
  for (const [tool, boards] of needed) {
    const path = which(tool);
    const names = [...new Set(boards)];
    checks.push({
      name: tool, ok: true, ...(path ? {} : { warn: true }),
      detail: path ?? `not on PATH; keyloom flashes ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""} with it. Install it with \`brew install ${BREW_FORMULA[tool]}\``,
    });
  }

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

/** The MacBook remapper's setup, as warnings: a machine that never set it up shouldn't fail `keyloom doctor` (21). Read-only. */
export async function runRemapperChecks(over: RemapperOverrides = {}): Promise<DoctorCheck[]> {
  if (windowsUnavailable()) return [unavailableOnWindows("kanata remapping")];
  if (process.platform !== "darwin" && over.probe === undefined) return [];
  const board = listBoardDefinitions().find((b) => b.definition.firmware === "kanata");
  if (!board) return [];
  const report = await remapperDoctor(board.definition.id, over);
  const checks: DoctorCheck[] = report.findings.map((f) => ({
    name: `remapper ${f.name}`, ok: true, ...(f.status === "ok" ? {} : { warn: true }), detail: `${f.detail}${f.fix ? ` (${f.fix})` : ""}`,
  }));
  if (report.rootCommand) checks.push({ name: "remapper root command", ok: true, warn: true, detail: `after \`keyloom remap setup\`, run once as an administrator: ${report.rootCommand}` });
  return checks;
}

/** Which keyboards are attached and whether keyloom's own firmware is on them, which decides if a flash needs a keypress. */
export async function runKeyboardChecks(over: HandsFreeOverrides = {}): Promise<DoctorCheck[]> {
  if (windowsDevicesUnavailable()) return [unavailableOnWindows("keyboards over USB, raw HID and serial")];
  if (windowsUnavailable()) return runWindowsDeviceChecks(over);
  const deps = realHandsFreeDeps(over);
  let attached: Awaited<ReturnType<typeof attachedKeyboards>>;
  try {
    attached = await attachedKeyboards(deps);
  } catch (err) {
    return [{ name: "keyboard", ok: true, warn: true, detail: `couldn't read the USB devices: ${(err as Error).message}` }];
  }
  const checks: DoctorCheck[] = [];
  for (const k of attached) {
    const name = `keyboard ${k.boardId} ${k.revisionId}`;
    if (k.firmware.state === "keyloom") {
      const hid = await rawHidFinding(deps, k);
      checks.push({
        name, ok: !hid.includes("permission denied"), ...(hid.includes("visible") ? {} : { warn: true }),
        detail: `running keyloom build ${k.firmware.serial}; the next flash needs no keypress (${hid})`,
      });
    } else if (k.firmware.state === "other") {
      checks.push({
        name, ok: true,
        detail: k.target
          ? `running firmware keyloom didn't build (USB serial ${k.firmware.serial ?? "unavailable"}); the first flash needs the bootloader key, and flashes after it need none`
          : `running firmware keyloom didn't build (USB serial ${k.firmware.serial ?? "unavailable"}); keyloom builds for it, and every flash needs the board's own bootloader key`,
      });
    }
  }
  // A ZMK half reports through its serial port, so the halves are read apart from the QMK keyboards above.
  try {
    for (const h of await attachedZmkHalves(realZmkHandsFreeDeps({ usb: deps.usb, ...over.zmk }))) {
      const name = `keyboard ${h.boardId} ${h.label}`;
      if (h.firmware.state === "keyloom") {
        checks.push({ name, ok: !h.permissionDenied, detail: h.permissionDenied
          ? "ttyACM read/write permission denied; join the group owning the port (usually dialout or uucp), log out and back in, then retry"
          : `running keyloom build ${h.firmware.key} (serial port ${h.firmware.path}); the next flash needs no keypress` });
      } else if (h.firmware.state === "other") {
        checks.push({ name, ok: true, detail: `running firmware without keyloom's module (USB serial ${h.firmware.serial ?? "unavailable"}); the first flash needs the bootloader key, and flashes after it need none` });
      }
    }
  } catch (err) {
    checks.push({ name: "keyboard serial ports", ok: true, warn: true, detail: `couldn't read the USB serial ports: ${(err as Error).message}` });
  }
  if (checks.length === 0) return [{ name: "keyboard", ok: true, detail: "no keyboard keyloom can flash is attached" }];
  return checks;
}

/** Metadata/caps only. A busy open is authoritative; doctor never opens a COM port to test it. */
export async function runWindowsDeviceChecks(over: HandsFreeOverrides = {}): Promise<DoctorCheck[]> {
  const hid = realHandsFreeDeps(over).hid;
  const serial = realZmkHandsFreeDeps(over.zmk).serial;
  const checks: DoctorCheck[] = [];
  for (const [transport, list] of [
    ["HID", async () => (await hid()).list()],
    ["COM", async () => (await serial()).list()],
  ] as const) {
    try {
      const records = await list();
      for (const record of records) {
        checks.push({ name: `keyboard ${transport} ${record.vendorId.toString(16)}:${record.productId.toString(16)}`, ok: !record.driverMissing,
          detail: record.driverMissing ? (transport === "HID" ? WINDOWS_HID_DRIVER_HINT : WINDOWS_COM_DRIVER_HINT)
            : `${transport} interface visible; hardware acceptance pending${transport === "COM" ? `; If opening reports busy, close the serial monitor or other client. Port availability is checked only when you explicitly open it.` : ""}` });
      }
    } catch (error) {
      checks.push({ name: `keyboard ${transport}`, ok: false, detail: error instanceof DeviceTransportError && error.detail.code === "busy" ? (transport === "COM" ? WINDOWS_BUSY_HINT : "busy: another keyloom instance holds this HID endpoint; stop it and try again") : `couldn't list ${transport} interfaces: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return checks.length ? checks : [{ name: "keyboard", ok: true, detail: "no supported HID or COM keyboard interface found; hardware acceptance pending" }];
}
