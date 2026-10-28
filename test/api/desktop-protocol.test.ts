// The desktop shell and the keyloom it bundles agree on a protocol number (D-454). Two tests keep it honest: the Rust constant equals
// the TypeScript one, and the part of the wire the shell reads can't change shape without somebody deciding whether to bump the number.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DESKTOP_PROTOCOL } from "../../src/api/desktop-protocol.ts";
import { MenuBarSchema, SyncEventSchema } from "../../src/api/http.ts";

const SHELL = join(import.meta.dir, "../../desktop/tauri/src-tauri/src");
const BUMP = "The desktop shell reads this. If the change is one the shell must know about, bump DESKTOP_PROTOCOL in src/api/desktop-protocol.ts AND in desktop/tauri/src-tauri/src/sidecar.rs, then update this pin. If the shell ignores it, just update the pin.";

describe("desktop protocol", () => {
  test("sidecar.rs compiles in the same number as src/api/desktop-protocol.ts", () => {
    const rust = readFileSync(join(SHELL, "sidecar.rs"), "utf8");
    const match = rust.match(/const\s+DESKTOP_PROTOCOL\s*:\s*u32\s*=\s*(\d+)\s*;/);
    expect(match, "sidecar.rs has no `const DESKTOP_PROTOCOL: u32 = N;`").not.toBeNull();
    expect(Number(match![1])).toBe(DESKTOP_PROTOCOL);
  });

  test("the shell passes the number to serve as --client-protocol", () => {
    expect(readFileSync(join(SHELL, "sidecar.rs"), "utf8")).toMatch(/"--client-protocol"/);
  });

  test("the menuBar object in /api/events frames keeps its shape", () => {
    const { $schema: _unused, ...shape } = z.toJSONSchema(MenuBarSchema) as Record<string, unknown>;
    const pinned = {
      type: "object",
      properties: {
        summary: { type: "string" },
        title: { type: ["string", "null"] },
        lines: { type: "array", items: { type: "object", properties: { boardId: { type: "string" }, text: { type: "string" } }, required: ["boardId", "text"], additionalProperties: false } },
        syncLayoutId: { type: ["string", "null"] },
        notices: { type: "array", items: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"], additionalProperties: false } },
      },
      required: ["summary", "title", "lines", "syncLayoutId", "notices"],
      additionalProperties: false,
    };
    if (JSON.stringify(shape) !== JSON.stringify(pinned)) throw new Error(`MenuBarSchema changed. ${BUMP}\nnow: ${JSON.stringify(shape)}`);
  });

  test("the sync frame still carries menuBar, and the shell's MenuBar struct reads exactly the fields the schema has", () => {
    expect(Object.keys(SyncEventSchema.shape)).toContain("menuBar");
    const rust = readFileSync(join(SHELL, "menu_bar.rs"), "utf8");
    const body = rust.match(/pub struct MenuBar \{([^}]*)\}/)?.[1] ?? "";
    const fields = [...body.matchAll(/pub (\w+):/g)].map((m) => m[1]!.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())).sort();
    const schema = Object.keys(MenuBarSchema.shape).sort();
    if (JSON.stringify(fields) !== JSON.stringify(schema)) throw new Error(`menu_bar.rs MenuBar fields ${fields} differ from MenuBarSchema ${schema}. ${BUMP}`);
  });
});
