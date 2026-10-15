// Defined symbol names of a 32-bit little-endian ELF (what arm-none-eabi-gcc links for the STM32 boards).
// Used to check a build really contains a function it was asked to add, without needing the toolchain on the host.
const SHT_SYMTAB = 2;

export class ElfError extends Error {
  override name = "ElfError";
}

export function definedSymbols(bytes: Uint8Array): Set<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 52 || view.getUint32(0, false) !== 0x7f454c46) throw new ElfError("not an ELF file");
  if (bytes[4] !== 1 || bytes[5] !== 1) throw new ElfError("only 32-bit little-endian ELF files are read");
  const shoff = view.getUint32(32, true);
  const shentsize = view.getUint16(46, true);
  const shnum = view.getUint16(48, true);
  const section = (i: number) => {
    const o = shoff + i * shentsize;
    if (o + 40 > bytes.length) throw new ElfError("section header table is cut off");
    return { type: view.getUint32(o + 4, true), offset: view.getUint32(o + 16, true), size: view.getUint32(o + 20, true), link: view.getUint32(o + 24, true), entsize: view.getUint32(o + 36, true) };
  };
  const names = new Set<string>();
  const text = new TextDecoder();
  for (let i = 0; i < shnum; i++) {
    const symtab = section(i);
    if (symtab.type !== SHT_SYMTAB) continue;
    const strtab = section(symtab.link);
    const count = Math.floor(symtab.size / (symtab.entsize || 16));
    for (let s = 0; s < count; s++) {
      const o = symtab.offset + s * (symtab.entsize || 16);
      const nameOffset = view.getUint32(o, true);
      const shndx = view.getUint16(o + 14, true);
      if (shndx === 0 || nameOffset === 0) continue; // undefined or unnamed
      const start = strtab.offset + nameOffset;
      const end = bytes.indexOf(0, start);
      names.add(text.decode(bytes.subarray(start, end < 0 ? bytes.length : end)));
    }
  }
  return names;
}
