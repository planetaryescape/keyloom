import { describe, expect, test } from "bun:test";
import { describeUf2, inspectUf2, uf2Problem } from "../../../src/firmware/zmk/uf2.ts";
import { combinedUf2, uf2Image } from "../../helpers/zmk.ts";

describe("UF2 files", () => {
  test("a combined Glove80 build is two images at the same addresses, told apart by family ID", () => {
    const info = inspectUf2(combinedUf2());
    expect(info).toEqual({
      bytes: 10 * 512,
      images: [
        { family: 0x9807b007, blocks: 6, firstAddress: 0x26000, lastAddress: 0x26000 + 5 * 256 + 256 },
        { family: 0x9808b007, blocks: 4, firstAddress: 0x26000, lastAddress: 0x26000 + 3 * 256 + 256 },
      ],
    });
    expect(describeUf2(info as never)).toBe("2 images: family 0x9807b007, 6 blocks, 0x00026000..0x00026600; family 0x9808b007, 4 blocks, 0x00026000..0x00026400");
    expect(uf2Problem(combinedUf2())).toBeUndefined();
  });

  test("a file that is not whole blocks, has a bad magic number or an impossible size is not UF2", () => {
    expect(uf2Problem(new Uint8Array(100))).toContain("isn't a whole number of 512-byte");
    expect(uf2Problem(new Uint8Array(0))).toContain("isn't a whole number");
    expect(uf2Problem(new Uint8Array(512))).toContain("block 0 doesn't have the UF2 magic numbers");
    const damagedEnd = combinedUf2();
    damagedEnd[512 * 3 + 508] = 0;
    expect(uf2Problem(damagedEnd)).toContain("block 3 doesn't have the UF2 magic numbers");
    const big = uf2Image(1, 1);
    new DataView(big.buffer).setUint32(16, 500, true);
    expect(uf2Problem(big)).toContain("claims 500 payload bytes");
  });

  test("one image, or two with the same family, can't be told apart by the halves, so it is not a Glove80 build", () => {
    expect(uf2Problem(uf2Image(0x9807b007, 3))).toContain("holds 1 UF2 image");
    const same = new Uint8Array([...uf2Image(0x9807b007, 2), ...uf2Image(0x9807b007, 2)]);
    expect(uf2Problem(same)).toContain("different family IDs");
  });
});
