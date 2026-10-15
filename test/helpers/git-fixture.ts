import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./tmp.ts";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  // Submodules over file:// are refused by default; the fixtures are local on purpose.
  GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.file.allow", GIT_CONFIG_VALUE_0: "always",
};

export function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...GIT_ENV } });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

/** A local repo with a Makefile and, optionally, one submodule. The stand-in for ZSA's fork in tests. */
export function originRepo(opts: { submodule?: boolean; makefile?: boolean } = {}): { url: string; sha: string; dir: string } {
  const dir = join(tempDir("keyloom-origin-"), "fork");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "--quiet", "-b", "main");
  if (opts.makefile !== false) writeFileSync(join(dir, "Makefile"), "all:\n");
  mkdirSync(join(dir, "keyboards"), { recursive: true });
  writeFileSync(join(dir, "keyboards", ".keep"), "");
  if (opts.submodule) {
    const sub = join(tempDir("keyloom-sub-"), "chibios");
    mkdirSync(sub, { recursive: true });
    git(sub, "init", "--quiet", "-b", "main");
    writeFileSync(join(sub, "os.c"), "int os;\n");
    git(sub, "add", "-A");
    git(sub, "commit", "--quiet", "-m", "sub");
    git(dir, "submodule", "--quiet", "add", sub, "lib/chibios");
  }
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "pin");
  return { url: `file://${dir}`, sha: git(dir, "rev-parse", "HEAD"), dir };
}

export const gitEnv = GIT_ENV;
