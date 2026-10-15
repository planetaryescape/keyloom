import { describe, expect, test } from "bun:test";
import { artifactKind, artifactProblem } from "../../../src/firmware/qmk/artifact.ts";
import { dfuImage } from "../../helpers/fake-bin.ts";
import { uf2Image } from "../../helpers/zmk.ts";

const text = (s: string) => new TextEncoder().encode(s);
const zapp = { kind: "zapp", bootloader: "0483:df11" } as const;
const manual = { kind: "manual", instructions: "Use QMK Toolbox." } as const;
const hex = ":020000040000FA\n:00000001FF\n";

describe("artifactKind", () => {
  test("is bin unless the build says otherwise", () => {
    expect(artifactKind({ artifact: undefined } as never)).toBe("bin");
    expect(artifactKind({ artifact: "hex" } as never)).toBe("hex");
  });
});

describe("artifactProblem", () => {
  test("a Zapp-flashed file is checked against the bootloader it is for, whatever its extension", () => {
    expect(artifactProblem(dfuImage("0483:df11"), "bin", zapp)).toBeUndefined();
    expect(artifactProblem(dfuImage("3297:2003"), "bin", zapp)).toContain("3297:2003 bootloader");
    expect(artifactProblem(text("raw"), "bin", zapp)).toContain("no DFU suffix");
  });

  test("an empty file is never kept", () => {
    expect(artifactProblem(new Uint8Array(), "bin", manual)).toBe("the file is empty");
  });

  test("Intel HEX must end with its end-of-file record", () => {
    expect(artifactProblem(text(hex), "hex", manual)).toBeUndefined();
    expect(artifactProblem(text(":020000040000FA\n"), "hex", manual)).toContain("no end-of-file record");
    expect(artifactProblem(text("hello"), "hex", manual)).toContain("isn't an Intel HEX file");
  });

  test("a UF2 must be a single image", () => {
    const one = uf2Image(0xe48bff56, 3);
    expect(artifactProblem(one, "uf2", manual)).toBeUndefined();
    const two = new Uint8Array([...one, ...uf2Image(0xe48bff56, 3)]);
    expect(artifactProblem(two, "uf2", manual)).toContain("single image");
    expect(artifactProblem(text("x".repeat(512)), "uf2", manual)).toContain("magic");
  });

  test("a plain .bin with no flasher that checks it only has to exist", () => {
    expect(artifactProblem(text("anything"), "bin", manual)).toBeUndefined();
  });
});
