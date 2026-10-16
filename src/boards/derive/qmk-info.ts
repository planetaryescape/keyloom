// A QMK keyboard's resolved info, built the way QMK's own `qmk info` builds it: every `info.json` and `keyboard.json` from
// the top of `keyboards/` down to the keyboard's folder, each merged over the last (docs/reference_info_json.md).
// QMK's own tool needs a checkout and Python, and keyloom has neither at the moment it meets an unknown board, so this is
// the small part of it keyloom uses: USB identity, bootloader, split flag and layouts. Pure; callers supply the files' text.
import { z } from "zod";
import type { GeometryKey } from "../schema.ts";

export type Json = Record<string, unknown>;

const isDict = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Dicts merge key by key; lists and scalars are replaced. This is QMK's `deep_update` rule, and it is why a child's `layouts` adds to its parent's. */
export function mergeInfo(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const prior = out[k];
    out[k] = isDict(prior) && isDict(v) ? mergeInfo(prior, v) : v;
  }
  return out;
}

export const hex4 = (v: unknown): string | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^(0x)?[0-9a-f]+$/i.test(v) ? Number.parseInt(v.replace(/^0x/i, ""), 16) : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= 0xffff ? `0x${n.toString(16).padStart(4, "0")}` : undefined;
};

/** QMK writes `device_version` as `major.minor.patch` and the USB descriptor's bcdDevice as `0x` + two digits + one + one (`0.0.1` is `0x0001`). */
export const bcdOfVersion = (v: unknown): string | undefined => {
  const m = typeof v === "string" ? /^(\d{1,2})\.(\d)\.(\d)$/.exec(v) : null;
  return m ? `0x${(m[1] as string).padStart(2, "0")}${m[2]}${m[3]}` : undefined;
};

const QmkKeySchema = z.object({
  x: z.number(), y: z.number(), w: z.number().optional(), h: z.number().optional(),
  r: z.number().optional(), rx: z.number().optional(), ry: z.number().optional(),
  matrix: z.tuple([z.number(), z.number()]).optional(),
});
export type QmkKey = z.infer<typeof QmkKeySchema>;
const LayoutsSchema = z.record(z.string(), z.object({ layout: z.array(QmkKeySchema) }));

export type DevBoards = Record<string, { bootloader?: string }>;

export type QmkResolved = {
  name: string | undefined;
  maker: string | undefined;
  vid: string | undefined;
  pid: string | undefined;
  /** bcdDevice as the descriptor carries it (`0x0001`). */
  bcd: string | undefined;
  /** `bootloader` as written, else the development board's (a Pro Micro is Caterina). Undefined when neither says; rules.mk-only boards land here. */
  bootloader: string | undefined;
  /** `bootloader_instructions`: the maintainer's own words on how to reach the bootloader, where they wrote any. */
  bootInstructions: string | undefined;
  split: boolean;
  /** Layout name to its keys, in the order of the layout macro. */
  layouts: Record<string, QmkKey[]>;
  /** `LAYOUT` to the layout it names, for keyboards that call the macro something more specific. */
  aliases: Record<string, string>;
};

export function resolveQmk(chain: readonly Json[], devBoards: DevBoards = {}): QmkResolved {
  const info = chain.reduce<Json>((acc, file) => mergeInfo(acc, file), {});
  const usb = isDict(info.usb) ? info.usb : {};
  const dev = typeof info.development_board === "string" ? devBoards[info.development_board] : undefined;
  const bootloader = typeof info.bootloader === "string" ? info.bootloader : dev?.bootloader;
  const layouts = LayoutsSchema.safeParse(info.layouts ?? {});
  const split = isDict(info.split) && info.split.enabled === true;
  return {
    name: typeof info.keyboard_name === "string" ? info.keyboard_name : undefined,
    maker: typeof info.manufacturer === "string" ? info.manufacturer : undefined,
    vid: hex4(usb.vid),
    pid: hex4(usb.pid),
    bcd: bcdOfVersion(usb.device_version),
    bootloader,
    bootInstructions: typeof info.bootloader_instructions === "string" ? info.bootloader_instructions : undefined,
    split,
    layouts: layouts.success ? Object.fromEntries(Object.entries(layouts.data).map(([k, v]) => [k, v.layout])) : {},
    aliases: isDict(info.layout_aliases) ? Object.fromEntries(Object.entries(info.layout_aliases).filter((e): e is [string, string] => typeof e[1] === "string")) : {},
  };
}

/** The files a keyboard's info comes from, outermost first: for `crkbd/rev1`, crkbd's two files and then rev1's two. */
export function infoChainPaths(target: string): string[] {
  const parts = target.split("/");
  return parts.flatMap((_, i) => {
    const dir = `keyboards/${parts.slice(0, i + 1).join("/")}`;
    return [`${dir}/info.json`, `${dir}/keyboard.json`];
  });
}

/** QMK omits w, h, r, rx and ry when they are 1, 1, 0, 0 and 0. */
export const toGeometryKeys = (keys: readonly QmkKey[]): GeometryKey[] =>
  keys.map((k) => ({ x: k.x, y: k.y, w: k.w ?? 1, h: k.h ?? 1, r: k.r ?? 0, rx: k.rx ?? 0, ry: k.ry ?? 0 }));

/** The layout `keyboard add` should use when the person did not choose one: the macro keymaps are written with (`LAYOUT`, through its alias), else the only layout. */
export function defaultLayout(layouts: Readonly<Record<string, number>>, aliases: Readonly<Record<string, string>> = {}): string | undefined {
  const names = Object.keys(layouts);
  const aliased = aliases.LAYOUT;
  if (aliased !== undefined && layouts[aliased] !== undefined) return aliased;
  if (layouts.LAYOUT !== undefined) return "LAYOUT";
  return names.length === 1 ? names[0] : undefined;
}

/** The last file in the chain that defines `layout`, which is the file geometry is regenerated from (src/boards/geometry.ts reads a single file). */
export function layoutSource(files: ReadonlyArray<{ path: string; info: Json }>, layout: string): { path: string; keys: QmkKey[] } | undefined {
  for (const file of [...files].reverse()) {
    const parsed = LayoutsSchema.safeParse(file.info.layouts ?? {});
    const found = parsed.success ? parsed.data[layout] : undefined;
    if (found) return { path: file.path, keys: found.layout };
  }
  return undefined;
}
