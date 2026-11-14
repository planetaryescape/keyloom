// The lock replaces imported west manifests. Builds never resolve a mutable ref (D-581).
import { join } from "node:path";
import type { ZmkWestDockerBuild } from "../../boards/recipes.ts";
import { BuildFailure } from "../toolchain/build-failure.ts";
import { ensureTrustedCheckout } from "../toolchain/checkout.ts";
import { ensureSourceVolume, type SourceTree } from "../toolchain/source-volume.ts";
import type { LogSink } from "../toolchain/run.ts";
import { withWorkspace } from "../toolchain/workspace.ts";
import inputs from "./west-inputs.json" with { type: "json" };

export const WEST_WORK_DIR = "/keyloom-sources";
export const WEST_CONFIG_DIR = "/tmp/keyloom-config";
export const WEST_BUILD_DIR = "/tmp/keyloom-build";

/** User inputs and compiler output stay private. West discovers its immutable manifest beside source. */
export function westLocalWorkspace(withModule = false): string[] {
  return [
    `cp -a /work/config ${WEST_CONFIG_DIR}`,
    ...(withModule ? ["cp -a /work/keyloom-zmk /tmp/keyloom-zmk"] : []),
    `cd ${WEST_WORK_DIR}`,
  ];
}

export type WestProject = {
  name: string;
  url: string;
  revision: string;
  path?: string;
  "west-commands"?: string;
  groups?: string[];
};

export function westProjects(repo: string, sha: string, build?: Pick<ZmkWestDockerBuild, "boardModule" | "rgbMatrix">): WestProject[] {
  if (sha !== inputs.zmkSha) throw new BuildFailure(`ZMK ${sha} has no reviewed dependency lock. Add its resolved west inputs before building this revision.`);
  const projects: WestProject[] = inputs.projects.map((p) => p.name === "zmk" ? { ...p, url: repo } : { ...p });
  if (build?.boardModule) projects.push({ name: "board-module", url: build.boardModule.repo, revision: build.boardModule.sha });
  if (build?.rgbMatrix) projects.push({ name: "zmk-rgb-matrix", url: build.rgbMatrix.module.repo, revision: build.rgbMatrix.module.sha });
  return projects;
}

/** JSON is also YAML. No imports remain for west to resolve at build time. */
export function lockedWestManifest(projects: readonly WestProject[]): string {
  return `${JSON.stringify({ manifest: { projects, self: { path: "config" } } }, null, 2)}\n`;
}

export function westInputsKey(projects: readonly WestProject[], image: string): string {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify([image, projects])).digest("hex");
}

export function westSourceSpec(workspace: string, project: WestProject, identity: string) {
  return { dir: join(`${workspace}.west-sources-v1`, identity, project.name), repo: project.url, sha: project.revision, submodules: [] };
}

/** The caller holds the workspace lock and stops orphan containers before replacing output. */
export async function withWestWorkspace<T>(
  workspace: string,
  projects: readonly WestProject[],
  image: string,
  hooks: { log?: LogSink; onLine?: (line: string) => void; signal?: AbortSignal },
  build: (dir: string, mounts: string[]) => Promise<T>,
): Promise<T> {
  const identity = westInputsKey(projects, image);
  const sources: SourceTree[] = [];
  for (const project of projects) {
    const source = await ensureTrustedCheckout(westSourceSpec(workspace, project, identity), hooks);
    sources.push({ dir: source, path: project.path ?? project.name });
  }
  const volume = await ensureSourceVolume(workspace, identity, image, sources, hooks, lockedWestManifest(projects));
  const mounts = ["--mount", `type=volume,src=${volume},dst=/keyloom-sources,readonly`];
  if (hooks.signal?.aborted) throw new BuildFailure("The build was cancelled.");
  // Old .west and .git files are untrusted too. The stable snapshot never becomes an input.
  return withWorkspace(workspace, (dir) => build(dir, mounts));
}
