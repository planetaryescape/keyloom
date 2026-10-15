// Apply on a kanata board (21#apply-verify-and-safety): write the file, check it, tell kanata to reload it, read back what
// it is running. There is no build and no flash. The order is chosen so that nothing broken is ever loaded and nothing
// good is ever lost: the candidate is checked under another name first, a failed reload puts the previous file back, and
// kanata itself keeps its old config when a file doesn't parse.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { type KanataEndpoint, KanataConnectionError, fakeKeyNames, layerNames, reloadFile } from "./client.ts";
import { type KanataSource, KBD_FILE, SAFE_FILE, SAFE_REVISION, SETUP_REVISION } from "./generate.ts";
import { markerName, readHeader } from "./header.ts";
import type { RemapperPaths } from "./paths.ts";

export type ApplyDeps = {
  paths: RemapperPaths;
  endpoint: KanataEndpoint;
  /** `kanata --check` on a file. */
  check(path: string): Promise<{ ok: boolean; output: string }>;
  now?: () => number;
};

export type ApplyStep = "write" | "check" | "not_keyloom" | "not_connected" | "reload" | "verify";

export type ApplyResult =
  | { ok: true; ms: number; revisionId: string }
  | { ok: false; step: ApplyStep; error: string; /** The file on disk now holds the new revision, though nothing confirmed kanata runs it. */ written: boolean };

/** Writes `text` so a reader sees the old file or the new one and never half of one. The temporary name is this call's own, so two applies never share it. */
async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path).catch(async (err) => {
    await rm(tmp, { force: true });
    throw err;
  });
}

const read = async (path: string): Promise<string | undefined> => readFile(path, "utf8").catch(() => undefined);

export type ApplyOptions = {
  /** Replace a keyloom.kbd that keyloom didn't write, keeping the old one beside it as keyloom.kbd.before-keyloom. */
  overwriteForeign?: boolean;
};

export async function applyKanata(deps: ApplyDeps, source: KanataSource, revisionId: string, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const { paths } = deps;
  const kbd = source.files.find((f) => f.path === KBD_FILE);
  const safe = source.files.find((f) => f.path === SAFE_FILE);
  if (!kbd || !safe) return { ok: false, step: "write", error: "the generated source has no keyloom.kbd or safe.kbd", written: false };

  const before = await read(paths.kbd);
  if (before !== undefined) {
    const header = readHeader(before);
    if (!header || !header.intact) {
      if (!opts.overwriteForeign) {
        return {
          ok: false, step: "not_keyloom", written: false,
          error: `${paths.kbd} wasn't written by keyloom${header ? " (it has been edited by hand)" : ""}, so keyloom left it alone. Move it aside, or apply with the overwrite option to keep a copy and replace it.`,
        };
      }
      await writeFile(`${paths.kbd}.before-keyloom`, before);
    }
  }

  try {
    await mkdir(paths.dir, { recursive: true });
    // The candidate is checked under its own name, so a config kanata refuses never replaces a working one.
    const candidate = `${paths.kbd}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.candidate`;
    await writeFile(candidate, kbd.content);
    const checked = await deps.check(candidate);
    if (!checked.ok) {
      await rm(candidate, { force: true });
      return { ok: false, step: "check", written: false, error: `kanata --check refused the new config, so nothing was changed: ${checked.output.split("\n").slice(-6).join(" ")}` };
    }
    await writeAtomic(paths.safe, safe.content);
    await rename(candidate, paths.kbd);
  } catch (err) {
    return { ok: false, step: "write", written: false, error: `couldn't write ${paths.kbd}: ${(err as Error).message}` };
  }

  const restore = async () => {
    if (before !== undefined) await writeAtomic(paths.kbd, before).catch(() => undefined);
  };

  try {
    const reloaded = await reloadFile(deps.endpoint, paths.kbd);
    if (!reloaded.ok) {
      await restore();
      return { ok: false, step: "reload", written: false, error: "kanata refused to load the new config and is still running the previous one, which keyloom put back on disk" };
    }
  } catch (err) {
    if (err instanceof KanataConnectionError) {
      return { ok: false, step: "not_connected", written: true, error: `the new config is on disk, but kanata isn't running or isn't listening on port ${deps.endpoint.port}: ${err.message}` };
    }
    await restore();
    return { ok: false, step: "reload", written: false, error: (err as Error).message };
  }

  try {
    const [names, keys] = await Promise.all([layerNames(deps.endpoint), fakeKeyNames(deps.endpoint)]);
    const wanted = source.layerNames;
    if (names.join("\n") !== wanted.join("\n")) {
      return { ok: false, step: "verify", written: true, error: `kanata reloaded, but its layers (${names.join(", ") || "none"}) aren't the ones keyloom wrote (${wanted.join(", ")})` };
    }
    if (!keys.includes(markerName(revisionId))) {
      return { ok: false, step: "verify", written: true, error: `kanata reloaded, but it doesn't report keyloom's revision marker ${markerName(revisionId)}` };
    }
  } catch (err) {
    return { ok: false, step: "verify", written: true, error: `couldn't read back what kanata runs: ${(err as Error).message}` };
  }
  return { ok: true, ms: now() - started, revisionId };
}

export type DisableResult = { ok: true } | { ok: false; error: string };

/** "Disable remapping": load the identity map. kanata keeps running and changes nothing, and no sudo is needed (D-235). */
export async function disableRemapping(deps: ApplyDeps, safeText: string): Promise<DisableResult> {
  try {
    await mkdir(deps.paths.dir, { recursive: true });
    await writeAtomic(deps.paths.safe, safeText);
    const r = await reloadFile(deps.endpoint, deps.paths.safe);
    if (!r.ok) return { ok: false, error: "kanata refused safe.kbd" };
    const keys = await fakeKeyNames(deps.endpoint);
    if (!keys.includes(markerName(SAFE_REVISION))) return { ok: false, error: "kanata reloaded, but it isn't running keyloom's safe.kbd" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** What a running kanata is doing, for the sync state. Never throws: no kanata and an unreadable kanata look the same. */
export type RunningKanata =
  | { state: "absent"; why: string }
  | { state: "off" }
  | { state: "keyloom"; revisionId: string; layerNames: string[] }
  | { state: "other"; detail: string };

export async function readRunningKanata(endpoint: KanataEndpoint): Promise<RunningKanata> {
  let keys: string[];
  let names: string[];
  try {
    [keys, names] = await Promise.all([fakeKeyNames(endpoint), layerNames(endpoint)]);
  } catch (err) {
    return { state: "absent", why: (err as Error).message };
  }
  if (keys.includes(markerName(SAFE_REVISION))) return { state: "off" };
  const rev = keys.map((k) => new RegExp(`^keyloom-(rev_\\w+|${SETUP_REVISION})$`).exec(k)?.[1]).find((r) => r !== undefined);
  if (rev) return { state: "keyloom", revisionId: rev, layerNames: names };
  return { state: "other", detail: `kanata is running a config keyloom didn't write (layers: ${names.join(", ") || "none"})` };
}
