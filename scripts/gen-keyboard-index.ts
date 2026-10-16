// Regenerates src/boards/derive/keyboard-index.json from local checkouts of qmk_firmware and zmk at the pinned SHAs
// (src/boards/derive/pins.ts). Nothing is fetched at runtime; this is the only place the upstream trees are read.
//   git clone --filter=blob:none <repo> <dir> && git -C <dir> checkout <sha>
//   bun scripts/gen-keyboard-index.ts --qmk <qmk_firmware dir> --zmk <zmk dir>
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import Hjson from "hjson";
import { parseArgs } from "node:util";
import { type KeyboardIndex, KeyboardIndexSchema, type QmkEntry, type ZmkController, type ZmkEntry } from "../src/boards/derive/index-schema.ts";
import { PINNED_SOURCES } from "../src/boards/derive/pins.ts";
import { type DevBoards, type Json, infoChainPaths, resolveQmk } from "../src/boards/derive/qmk-info.ts";
import { defconfigIdentity, keyboardNames, physicalLayoutLabel } from "../src/boards/derive/zmk-source.ts";
import { definesLabel, parsePhysicalLayout } from "../src/boards/zmk-geometry.ts";

const { values } = parseArgs({ options: { qmk: { type: "string" }, zmk: { type: "string" }, out: { type: "string" } } });
if (!values.qmk || !values.zmk) {
  console.error("usage: bun scripts/gen-keyboard-index.ts --qmk <qmk_firmware dir> --zmk <zmk dir> [--out <file>]");
  process.exit(2);
}

const head = (dir: string): string => Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"]).stdout.toString().trim();
for (const [name, dir] of [["qmk", values.qmk], ["zmk", values.zmk]] as const) {
  if (head(dir) !== PINNED_SOURCES[name].sha) {
    console.error(`${dir} is at ${head(dir)}, not the pinned ${PINNED_SOURCES[name].sha}. Check out the pin, or change src/boards/derive/pins.ts on purpose.`);
    process.exit(1);
  }
}

const read = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8") : undefined);
const readJson = (path: string): Json | undefined => {
  const text = read(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
};

function walk(dir: string, keep: (path: string, name: string) => boolean, skipDir: (name: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!skipDir(e.name)) out.push(...walk(p, keep, skipDir));
    } else if (keep(p, e.name)) out.push(p);
  }
  return out;
}

// --- QMK ------------------------------------------------------------------------------------

const qmkRoot = values.qmk;
const devBoards = (Hjson.parse(read(join(qmkRoot, "data/mappings/defaults.hjson")) ?? "{}") as { development_board?: DevBoards }).development_board ?? {};
// A keyboard is a folder with a keyboard.json; `keymaps` and `lib` folders hold other json that is not one.
const keyboardDirs = walk(join(qmkRoot, "keyboards"), (_, name) => name === "keyboard.json", (name) => name === "keymaps").map((p) => relative(join(qmkRoot, "keyboards"), dirname(p)));

const qmk: QmkEntry[] = [];
let skippedNoUsb = 0;
for (const target of keyboardDirs.sort()) {
  const chain = infoChainPaths(target).flatMap((p) => {
    const j = readJson(join(qmkRoot, p));
    return j ? [j] : [];
  });
  const r = resolveQmk(chain, devBoards);
  if (r.vid === undefined || r.pid === undefined) {
    skippedNoUsb++;
    continue;
  }
  qmk.push({
    target,
    name: r.name ?? target.split("/").at(-1) ?? target,
    ...(r.maker === undefined ? {} : { maker: r.maker }),
    vid: r.vid,
    pid: r.pid,
    ...(r.bcd === undefined ? {} : { bcd: r.bcd }),
    ...(r.bootloader === undefined ? {} : { bootloader: r.bootloader }),
    ...(r.bootInstructions === undefined ? {} : { bootInstructions: r.bootInstructions }),
    split: r.split,
    layouts: Object.fromEntries(Object.entries(r.layouts).filter(([, keys]) => keys.length > 0).map(([n, keys]) => [n, keys.length])),
    ...(Object.keys(r.aliases).length ? { aliases: r.aliases } : {}),
  });
}

// --- ZMK ------------------------------------------------------------------------------------

const zmkApp = join(values.zmk, "app");
const layoutFiles = walk(join(zmkApp, "dts/layouts"), (_, n) => n.endsWith(".dtsi"));
const metadata = walk(join(zmkApp, "boards"), (_, n) => n.endsWith(".zmk.yml")).sort();
const zmk: ZmkEntry[] = [];
const controllers: ZmkController[] = [];

function layoutOf(shieldDir: string): ZmkEntry["layout"] {
  const own = walk(shieldDir, (_, n) => n.endsWith(".dtsi") || n.endsWith(".overlay"), (n) => n === "boards");
  const label = own.map((p) => physicalLayoutLabel(readFileSync(p, "utf8"))).find((l) => l !== undefined);
  if (label === undefined) return undefined;
  const file = [...own, ...layoutFiles].find((p) => definesLabel(readFileSync(p, "utf8"), label));
  if (file === undefined) return undefined;
  try {
    const keys = parsePhysicalLayout(readFileSync(file, "utf8"), label).length;
    return { file: relative(values.zmk as string, file), label, keys };
  } catch {
    return undefined; // a layout with no listed keys (ZMK allows that) has no geometry to read
  }
}

for (const file of metadata) {
  const meta = Bun.YAML.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const dir = dirname(file);
  const id = String(meta.id);
  const name = String(meta.name);
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  if (meta.type === "shield") {
    const siblings = strings(meta.siblings);
    const kconfig = read(join(dir, "Kconfig.defconfig"));
    const named = kconfig ? keyboardNames(kconfig) : [];
    const productNames: Record<string, string> = {};
    // Several shields can share one Kconfig.defconfig (the Kyria revisions), so only this shield's own build targets count.
    const own = siblings.length ? siblings : [id];
    for (const n of named) for (const s of n.shields.length ? n.shields : [id]) if (own.includes(s)) productNames[s] = n.name;
    const layout = layoutOf(dir);
    zmk.push({
      id, name, kind: "shield", siblings: siblings.length ? siblings : [id],
      ...(strings(meta.requires).length ? { requires: strings(meta.requires) } : {}),
      ...(Object.keys(productNames).length ? { productNames } : {}),
      ...(layout ? { layout } : {}),
      ...(strings(meta.features).length ? { features: strings(meta.features) } : {}),
    });
  } else if (meta.type === "board") {
    // A board with its own product string is a keyboard (the Glove80); one without is a controller a shield runs on.
    const identities = readdirSync(dir).filter((f) => f.endsWith("_defconfig")).map((f) => ({ f, ...defconfigIdentity(readFileSync(join(dir, f), "utf8")) }));
    const named = identities.filter((i) => i.name !== undefined);
    if (named.length === 0) {
      controllers.push({ id, name, exposes: strings(meta.exposes) });
    } else {
      const first = named[0] as (typeof named)[number];
      zmk.push({
        id, name, kind: "board", siblings: [id],
        productNames: Object.fromEntries(named.map((i) => [i.f.replace(/_defconfig$/, ""), i.name as string])),
        ...(first.vid ? { vid: first.vid } : {}),
        ...(first.pid ? { pid: first.pid } : {}),
        ...(strings(meta.features).length ? { features: strings(meta.features) } : {}),
      });
    }
  }
}

const index: KeyboardIndex = KeyboardIndexSchema.parse({
  schemaVersion: 1,
  sources: { qmk: PINNED_SOURCES.qmk, zmk: PINNED_SOURCES.zmk },
  qmk,
  zmk,
  controllers,
});

// One entry per line, so a regeneration diff shows exactly which keyboards changed.
const lines = (rows: unknown[]) => rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
const text = `{\n  "schemaVersion": 1,\n  "sources": ${JSON.stringify(index.sources)},\n  "qmk": [\n${lines(index.qmk)}\n  ],\n  "zmk": [\n${lines(index.zmk)}\n  ],\n  "controllers": [\n${lines(index.controllers)}\n  ]\n}\n`;
const out = values.out ?? join(import.meta.dir, "../src/boards/derive/keyboard-index.json");
writeFileSync(out, text);
console.log(`wrote ${out}: ${qmk.length} QMK keyboards (${skippedNoUsb} without USB ids left out), ${zmk.length} ZMK keyboards, ${controllers.length} controllers, ${(statSync(out).size / 1024).toFixed(0)} KB`);
