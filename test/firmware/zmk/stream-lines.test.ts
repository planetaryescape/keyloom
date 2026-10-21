import { expect, test } from "bun:test";
import { StreamLineError, StreamLines } from "../../../src/firmware/zmk/stream-lines.ts";

test("frames split newlines and multibyte UTF-8, including empty chunks", () => {
  const framer = new StreamLines();
  const bytes = new TextEncoder().encode("α\nβ\n");
  const lines: string[] = [];
  framer.push(new Uint8Array());
  for (const byte of bytes) lines.push(...framer.push(Uint8Array.of(byte)));
  framer.finish();
  expect(lines).toEqual(["α", "β"]);
});

test("accepts exactly 4096 UTF-8 bytes before LF and rejects 4097", () => {
  const accepted = new StreamLines();
  const boundary = new TextEncoder().encode(`${"a".repeat(4094)}é\n`);
  expect(boundary.byteLength).toBe(4097);
  expect(accepted.push(boundary)).toEqual([`${"a".repeat(4094)}é`]);
  accepted.finish();

  const rejected = new StreamLines();
  const tooLong = new TextEncoder().encode(`${"a".repeat(4095)}é\n`);
  expect(() => rejected.push(tooLong)).toThrow(StreamLineError);
});

test("bounds unterminated input while it arrives and rejects invalid or incomplete endings", () => {
  const overlong = new StreamLines();
  for (let i = 0; i < 4096; i++) overlong.push(Uint8Array.of(0x61));
  expect(() => overlong.push(Uint8Array.of(0x61))).toThrow("4096 UTF-8 bytes");

  const invalid = new StreamLines();
  expect(() => invalid.push(Uint8Array.of(0xff))).toThrow("invalid UTF-8");

  const partialCharacter = new StreamLines();
  partialCharacter.push(Uint8Array.of(0xe2, 0x82));
  expect(() => partialCharacter.finish()).toThrow("incomplete UTF-8");

  const partialLine = new StreamLines();
  partialLine.push(new TextEncoder().encode("KLTYPE ON 1"));
  expect(() => partialLine.finish()).toThrow("incomplete line");
});
