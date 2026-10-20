import { expect, test } from "bun:test";
import { probeLayoutExport } from "../../src/layout/export-document.ts";

test("binary archives and firmware comments mentioning the export marker remain third-party input", () => {
  expect(probeLayoutExport('PK\u0003\u0004keyloom-layout')).toEqual({ kind: "not-keyloom" });
  expect(probeLayoutExport('// keyloom-layout\n/ { keymap { }; };')).toEqual({ kind: "not-keyloom" });
  expect(probeLayoutExport('{"unrelated":"keyloom-layout"}')).toEqual({ kind: "not-keyloom" });
});

test("the parsed marker, including JSON escapes, identifies an unsupported version", () => {
  expect(probeLayoutExport('{"kind":"keyloom\\u002dlayout","schema_version":2}')).toMatchObject({ kind: "malformed", reason: "its schema_version is 2, and this keyloom reads 1" });
  expect(probeLayoutExport('{"kind":"keyloom-layout",')).toMatchObject({ kind: "malformed" });
});
