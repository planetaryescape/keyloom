// Seed trusted downloads so fake-Docker tests cannot fetch real firmware repositories.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { trustedCheckoutDir } from "../../src/firmware/toolchain/checkout.ts";
import { type WestProject, westInputsKey, westSourceSpec } from "../../src/firmware/zmk/west-workspace.ts";

export const FAKE_WEST_GIT = 'test "$3" = rev-parse || exit 9; cat "$2/.git/HEAD"';

export async function seedWestSources(workspace: string, projects: readonly WestProject[], image: string): Promise<void> {
  const identity = westInputsKey(projects, image);
  for (const project of projects) {
    const source = trustedCheckoutDir(westSourceSpec(workspace, project, identity));
    await mkdir(join(source, ".git"), { recursive: true });
    await Bun.write(join(source, ".git", "HEAD"), `${project.revision}\n`);
    // Fake Docker never extracts archives. The live mount test exercises real tar.
    await Bun.write(`${source}.source-v3.tar`, new Uint8Array(1024));
  }
}


export { FAKE_SOURCE_VOLUME } from "./source-volume.ts";
