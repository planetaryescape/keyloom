// A minimal 32-bit little-endian ELF whose symbol table defines the given names: enough for definedSymbols().
export function fakeElf(defined: string[], undefinedNames: string[] = []): Uint8Array {
  const names = [...defined, ...undefinedNames];
  const enc = new TextEncoder();
  const strtab: number[] = [0];
  const nameOffsets = names.map((n) => {
    const at = strtab.length;
    strtab.push(...enc.encode(n), 0);
    return at;
  });
  const symEntries = names.length + 1; // entry 0 is the reserved null symbol
  const symtabSize = symEntries * 16;
  const headerSize = 52;
  const strOffset = headerSize;
  const symOffset = strOffset + strtab.length + ((4 - (strtab.length % 4)) % 4);
  const shOffset = symOffset + symtabSize;
  const out = new Uint8Array(shOffset + 3 * 40);
  const v = new DataView(out.buffer);
  out.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1], 0); // magic, ELFCLASS32, little endian, version 1
  v.setUint16(16, 2, true); // ET_EXEC
  v.setUint16(18, 40, true); // EM_ARM
  v.setUint32(32, shOffset, true);
  v.setUint16(40, headerSize, true);
  v.setUint16(46, 40, true);
  v.setUint16(48, 3, true);
  out.set(strtab, strOffset);
  names.forEach((_, i) => {
    const o = symOffset + (i + 1) * 16;
    v.setUint32(o, nameOffsets[i] as number, true);
    v.setUint16(o + 14, i < defined.length ? 1 : 0, true); // section index 0 means undefined
  });
  const section = (i: number, type: number, offset: number, size: number, link: number, entsize: number) => {
    const o = shOffset + i * 40;
    v.setUint32(o + 4, type, true);
    v.setUint32(o + 16, offset, true);
    v.setUint32(o + 20, size, true);
    v.setUint32(o + 24, link, true);
    v.setUint32(o + 36, entsize, true);
  };
  section(1, 2, symOffset, symtabSize, 2, 16); // SHT_SYMTAB linked to section 2
  section(2, 3, strOffset, strtab.length, 0, 0); // SHT_STRTAB
  return out;
}
