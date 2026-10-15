// CONTRIBUTING.md's board.json reference is checked against the zod schema, so a field added to the
// schema without a row (or a row left behind after a field goes) fails here.
import { describe, expect, test } from "bun:test";
import { BoardDefinitionSchema } from "../../src/boards/schema.ts";
import { schemaPaths } from "../helpers/schema-fields.ts";

const doc = await Bun.file(`${import.meta.dir}/../../CONTRIBUTING.md`).text();

/** First-column code spans of the field reference table: rows that start with "| `path` |". */
const documented = [...doc.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1] as string);

describe("CONTRIBUTING.md field reference", () => {
  test("documents every field the schema has", () => {
    const missing = [...new Set(schemaPaths(BoardDefinitionSchema))].filter((p) => !documented.includes(p));
    expect(missing).toEqual([]);
  });

  test("documents no field the schema doesn't have", () => {
    const real = new Set(schemaPaths(BoardDefinitionSchema));
    expect(documented.filter((p) => !real.has(p))).toEqual([]);
  });

  test("documents each field once", () => {
    expect(documented.filter((p, i) => documented.indexOf(p) !== i)).toEqual([]);
  });

  test("names every recipe kind the schema accepts, in the recipe table", () => {
    for (const kind of ["qmk-docker", "zmk-west-docker", "zmk-moergo-template", "zapp", "uf2-drives", "manual"]) expect(doc).toContain(`\`${kind}\``);
  });
});

describe("CONTRIBUTING.md steps", () => {
  test("has the seven steps of the blueprint, in order", () => {
    const steps = [...doc.matchAll(/^### (\d)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`);
    expect(steps).toEqual([
      "1. Find the firmware tree and pin it",
      "2. Write `board.json`",
      "3. Generate `geometry.json`",
      "4. Fill in hands, fingers, rows and mirror",
      "5. Optionally write `SKILL.md`",
      "6. Check, import, build and flash",
      "7. Open the pull request",
    ]);
  });

  test("every keyloom command in a code block exists, with its subcommand and flags", () => {
    const blocks = [...doc.matchAll(/```sh\n([\s\S]*?)```/g)].flatMap((m) => (m[1] as string).split("\n"));
    const commands = blocks.map((l) => l.replace(/#.*$/, "").trim()).filter((l) => l.startsWith("keyloom "));
    expect(commands.length).toBeGreaterThan(8);
    const help = (...args: string[]) => Bun.spawnSync(["bun", `${import.meta.dir}/../../src/cli/main.ts`, ...args, "--help"]).stdout.toString();
    for (const command of commands) {
      const words = command.split(/\s+/).slice(1);
      const global = words[0] === "--data-dir" ? 2 : 0;
      const [top, sub] = words.slice(global);
      expect(help(), command).toMatch(new RegExp(`^  ${top}\\b`, "m"));
      if (sub !== undefined && /^[a-z]+$/.test(sub) && ["boards", "layout"].includes(top as string)) expect(help(top as string), command).toMatch(new RegExp(`^  ${sub}\\b`, "m"));
      for (const flag of words.filter((w) => w.startsWith("--") && w !== "--data-dir")) expect(help(top as string), command).toContain(flag);
    }
  });
});
