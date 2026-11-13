// The lock replaces imported west manifests. Builds never resolve a mutable ref (D-581).
import { join } from "node:path";
import type { ZmkWestDockerBuild } from "../../boards/recipes.ts";
import { BuildFailure } from "../toolchain/build-failure.ts";
import { ensureTrustedCheckout } from "../toolchain/checkout.ts";
import type { LogSink } from "../toolchain/run.ts";
import { withWorkspace } from "../toolchain/workspace.ts";
import inputs from "./west-inputs.json" with { type: "json" };

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
  const mounts: string[] = [];
  for (const project of projects) {
    const source = await ensureTrustedCheckout(westSourceSpec(workspace, project, identity), hooks);
    mounts.push("--mount", `type=bind,src=${source},dst=/work/${project.path ?? project.name},readonly`);
  }
  if (hooks.signal?.aborted) throw new BuildFailure("The build was cancelled.");
  // Old .west and .git files are untrusted too. The stable snapshot never becomes an input.
  return withWorkspace(workspace, (dir) => build(dir, mounts));
}
