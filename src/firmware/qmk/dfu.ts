// The DFU suffix at the end of a Moonlander .bin. Its VID:PID names the bootloader the binary is
// for (S11: reva 0483:df11, revb 3297:2003), so a binary for the wrong revision is caught before
// anything is flashed.
export type DfuSuffix = { vendorId: string; productId: string; bootloader: string; crcOk: boolean };

const hex4 = (n: number): string => n.toString(16).padStart(4, "0");

/** Standard CRC-32 without the final inversion, which is how DFU 1.1 defines the suffix CRC. */
function dfuCrc(data: Uint8Array): number {
  return ~Bun.hash.crc32(data) >>> 0;
}

/** The suffix, or undefined when the file doesn't end in one. */
export function readDfuSuffix(bytes: Uint8Array): DfuSuffix | undefined {
  if (bytes.length < 16) return undefined;
  const s = bytes.subarray(bytes.length - 16);
  const view = new DataView(s.buffer, s.byteOffset, 16);
  // Layout (little endian): bcdDevice, idProduct, idVendor, bcdDFU, "UFD", bLength, dwCRC.
  if (s[8] !== 0x55 || s[9] !== 0x46 || s[10] !== 0x44 || s[11] !== 16) return undefined;
  const productId = hex4(view.getUint16(2, true));
  const vendorId = hex4(view.getUint16(4, true));
  const crcOk = view.getUint32(12, true) === dfuCrc(bytes.subarray(0, bytes.length - 4));
  return { vendorId, productId, bootloader: `${vendorId}:${productId}`, crcOk };
}

/** Why `bytes` must not be flashed to a board whose bootloader is `expected`, or undefined when it can be. */
export function dfuProblem(bytes: Uint8Array, expected: string): string | undefined {
  const suffix = readDfuSuffix(bytes);
  if (!suffix) return "the file has no DFU suffix, so it isn't a Moonlander firmware image";
  if (!suffix.crcOk) return "the file's DFU checksum doesn't match its contents; it is damaged or incomplete";
  if (suffix.bootloader !== expected.toLowerCase()) {
    return `the file is built for the ${suffix.bootloader} bootloader, but this board revision flashes through ${expected}; build it again for the right revision`;
  }
  return undefined;
}
