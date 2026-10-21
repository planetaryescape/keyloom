import { expect, test } from "bun:test";
import { StreamLineError, StreamLines } from "../../../src/firmware/zmk/stream-lines.ts";

test("frames split newlines and multibyte UTF-8, including empty chunks", () => {
  const framer = new StreamLines();
  const bytes = new TextEncoder().encode("α\nβ\n");
  const lines: string[] = [];
  framer.push(new Uint8Array());
  for (const byte of bytes) lines.push(...framer.push(Uint8Array.of(byte)).lines);
  framer.finish();
  expect(lines).toEqual(["α", "β"]);
});

test("accepts exactly 4096 UTF-8 bytes before LF and rejects 4097", () => {
  const accepted = new StreamLines();
  const boundary = new TextEncoder().encode(`${"a".repeat(4094)}é\n`);
  expect(boundary.byteLength).toBe(4097);
  expect(accepted.push(boundary).lines).toEqual([`${"a".repeat(4094)}é`]);
  accepted.finish();

  const rejected = new StreamLines();
  const tooLong = new TextEncoder().encode(`${"a".repeat(4095)}é\n`);
  expect(rejected.push(tooLong).error).toBeInstanceOf(StreamLineError);
});

test("bounds unterminated input while it arrives and rejects invalid or incomplete endings", () => {
  const overlong = new StreamLines();
  for (let i = 0; i < 4096; i++) overlong.push(Uint8Array.of(0x61));
  expect(overlong.push(Uint8Array.of(0x61)).error?.message).toContain("4096 UTF-8 bytes");

  const invalid = new StreamLines();
  expect(invalid.push(Uint8Array.of(0xff)).error?.message).toContain("invalid UTF-8");

  const partialCharacter = new StreamLines();
  partialCharacter.push(Uint8Array.of(0xe2, 0x82));
  expect(() => partialCharacter.finish()).toThrow("incomplete UTF-8");

  const partialLine = new StreamLines();
  partialLine.push(new TextEncoder().encode("KLTYPE ON 1"));
  expect(() => partialLine.finish()).toThrow("incomplete line");
});

test("complete lines before invalid UTF-8 or an overlong line survive every chunk split", () => {
  const complete = new TextEncoder().encode("E 2 1 5010 255\nE 2 0 5020 255\n");
  const cases = [
    { bytes: Uint8Array.from([...complete, 0xff]), message: "invalid UTF-8" },
    { bytes: Uint8Array.from([...complete, ...new TextEncoder().encode(`${"x".repeat(4097)}\n`)]), message: "4096 UTF-8 bytes" },
  ];

  for (const { bytes, message } of cases) {
    for (let split = 0; split <= bytes.length; split++) {
      const framer = new StreamLines();
      const first = framer.push(bytes.subarray(0, split));
      const lines = [...first.lines];
      let error = first.error;
      if (!error) {
        const second = framer.push(bytes.subarray(split));
        lines.push(...second.lines);
        error = second.error;
      }
      expect(lines).toEqual(["E 2 1 5010 255", "E 2 0 5020 255"]);
      expect(error).toBeInstanceOf(StreamLineError);
      expect(error?.message).toContain(message);
    }
  }
});
