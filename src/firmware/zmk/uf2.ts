// UF2 files (https://github.com/microsoft/uf2): 512-byte blocks, each framed by three magic numbers.
// A Glove80 build is two images joined end to end, one per half (06, S8), so this reads the blocks and
// reports the images in it; it never decides what a bootloader will do with them.

const START0 = 0x0a324655;
const START1 = 0x9e5d5157;
const END = 0x0ab16f30;
const BLOCK = 512;
const FLAG_FAMILY = 0x2000;
const FLAG_NOT_MAIN = 0x1;

export type Uf2Image = {
  /** `0xada52840` when the image names a family, else null. */
  family: number | null;
  blocks: number;
  firstAddress: number;
  lastAddress: number;
};

export type Uf2Info = { bytes: number; images: Uf2Image[] };

const hex = (n: number): string => `0x${n.toString(16).padStart(8, "0")}`;
export const familyText = (f: number | null): string => (f === null ? "no family" : `family ${hex(f)}`);

/** The images in `bytes`, or why it is not a UF2 file. */
export function inspectUf2(bytes: Uint8Array): Uf2Info | { problem: string } {
  if (bytes.length === 0 || bytes.length % BLOCK !== 0) return { problem: `its size (${bytes.length} bytes) isn't a whole number of 512-byte UF2 blocks` };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const images: Uf2Image[] = [];
  let current: Uf2Image | undefined;
  for (let off = 0, n = 0; off < bytes.length; off += BLOCK, n++) {
    if (view.getUint32(off, true) !== START0 || view.getUint32(off + 4, true) !== START1 || view.getUint32(off + BLOCK - 4, true) !== END) {
      return { problem: `block ${n} doesn't have the UF2 magic numbers` };
    }
    const flags = view.getUint32(off + 8, true);
    const address = view.getUint32(off + 12, true);
    const size = view.getUint32(off + 16, true);
    const blockNo = view.getUint32(off + 20, true);
    if (size > 476) return { problem: `block ${n} claims ${size} payload bytes; a block holds at most 476` };
    // Blocks of the same image count up from zero, so a zero starts the next one.
    if (!current || blockNo === 0) {
      const family = (flags & FLAG_FAMILY) !== 0 ? view.getUint32(off + 28, true) : null;
      current = { family, blocks: 0, firstAddress: address, lastAddress: address };
      images.push(current);
    }
    if ((flags & FLAG_NOT_MAIN) === 0) {
      current.lastAddress = Math.max(current.lastAddress, address + size);
    }
    current.blocks++;
  }
  return { bytes: bytes.length, images };
}

/** One line for the build log: `2 images: family 0xada52840 (800 blocks at 0x00026000..), ...`. */
export function describeUf2(info: Uf2Info): string {
  return `${info.images.length} image${info.images.length === 1 ? "" : "s"}: ${info.images
    .map((i) => `${familyText(i.family)}, ${i.blocks} blocks, ${hex(i.firstAddress)}..${hex(i.lastAddress)}`)
    .join("; ")}`;
}

/**
 * Why `bytes` can't be flashed to a Glove80, or undefined. Both halves take the same file, so it holds
 * one image per half. They sit at the same addresses and are told apart by family ID (S8: seen in the
 * v26.09 build, 0x9807b007 and 0x9808b007), which is how a bootloader skips the other half's blocks.
 */
export function uf2Problem(bytes: Uint8Array): string | undefined {
  const info = inspectUf2(bytes);
  if ("problem" in info) return info.problem;
  if (info.images.length !== 2) return `it holds ${info.images.length} UF2 image${info.images.length === 1 ? "" : "s"}, but a Glove80 build is one image per half`;
  const [a, b] = info.images as [Uf2Image, Uf2Image];
  if (a.family === null || b.family === null || a.family === b.family) return "its two images don't have different family IDs, so a half couldn't tell which one is its own";
  return undefined;
}
