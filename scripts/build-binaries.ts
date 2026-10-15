#!/usr/bin/env bun
// Compiles the release binaries into dist/ and writes SHA256SUMS beside them.
//
//   bun run scripts/build-binaries.ts                       # all release targets
//   bun run scripts/build-binaries.ts --target bun-darwin-arm64
//   bun run scripts/build-binaries.ts --entry some/entry.ts  # override the entry point
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const RELEASE_TARGETS = {
  "bun-darwin-arm64": "keyloom-darwin-arm64",
  "bun-darwin-x64": "keyloom-darwin-x64",
  "bun-linux-x64": "keyloom-linux-x64",
} as const;

type BunTarget = keyof typeof RELEASE_TARGETS;
const ALL_TARGETS = Object.keys(RELEASE_TARGETS).filter(isBunTarget);

const DEFAULT_ENTRY = "src/cli/main.ts";
const OUT_DIR = "dist";

// TODO(integration): W1 reports what the compiled CLI needs for its WASM grammars
// (tree-sitter C and devicetree). Those embedding flags go in this list, so every target
// gets them.
const EMBED_FLAGS: readonly string[] = [];

interface Options {
  targets: BunTarget[];
  entry: string;
}

function parseArgs(argv: readonly string[]): Options {
  const targets: BunTarget[] = [];
  let entry = DEFAULT_ENTRY;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target") {
      const value = argv[++i];
      if (value === undefined || !isBunTarget(value)) {
        throw new Error(`--target must be one of: ${Object.keys(RELEASE_TARGETS).join(", ")}`);
      }
      targets.push(value);
    } else if (arg === "--entry") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--entry needs a path");
      entry = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { targets: targets.length > 0 ? targets : ALL_TARGETS, entry };
}

function isBunTarget(value: string): value is BunTarget {
  return Object.prototype.hasOwnProperty.call(RELEASE_TARGETS, value);
}

async function compile(target: BunTarget, entry: string): Promise<string> {
  const outfile = join(OUT_DIR, RELEASE_TARGETS[target]);
  const proc = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      "--minify",
      `--target=${target}`,
      entry,
      "--outfile",
      outfile,
      ...EMBED_FLAGS,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) throw new Error(`bun build failed for ${target} (exit ${code})`);
  return outfile;
}

// Lines match `sha256sum` output, so `sha256sum -c SHA256SUMS` works on the download.
async function writeChecksums(names: readonly string[]): Promise<void> {
  const lines: string[] = [];
  for (const name of [...names].sort()) {
    const bytes = await Bun.file(join(OUT_DIR, name)).bytes();
    const digest = createHash("sha256").update(bytes).digest("hex");
    lines.push(`${digest}  ${name}`);
  }
  await writeFile(join(OUT_DIR, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const { targets, entry } = parseArgs(process.argv.slice(2));
  if (!(await Bun.file(entry).exists())) throw new Error(`entry point not found: ${entry}`);
  await mkdir(OUT_DIR, { recursive: true });
  const built: string[] = [];
  for (const target of targets) {
    console.log(`building ${RELEASE_TARGETS[target]}`);
    built.push(await compile(target, entry));
  }
  await writeChecksums(built.map((path) => basename(path)));
  console.log(`wrote ${OUT_DIR}/SHA256SUMS`);
}

await main();
