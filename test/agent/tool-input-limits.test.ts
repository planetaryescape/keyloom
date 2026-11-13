import { expect, test } from "bun:test";
import { z } from "zod";
import { defineTool } from "../../src/agent/tools/define.ts";

const make = (schema: z.ZodObject) => {
  let ran = false;
  const tool = defineTool({ name: "synthetic", description: "Synthetic validation probe", inputSchema: schema, run: () => { ran = true; return "ok"; } });
  return { tool, ran: () => ran };
};

const errorOf = async (run: () => string | Promise<string>): Promise<Error> => {
  try { await run(); } catch (error) { if (error instanceof Error) return error; throw error; }
  throw new Error("invalid input was accepted");
};

test("a rejected oversized array stops before per-element validation and tool effects", async () => {
  let elements = 0;
  const schema = z.object({ positions: z.array(z.number().superRefine(() => { elements++; })).max(100) });
  const { tool, ran } = make(schema);
  const error = await errorOf(() => tool.run({ positions: Array(5000).fill(1) }));
  expect(elements).toBe(0);
  expect(ran()).toBe(false);
  expect(error.message).toContain("positions");
  expect(error.message.length).toBeLessThan(2048);
});

test("many invalid fields produce a bounded error with useful paths and an omitted count", async () => {
  const schema = z.object(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`field${i}`, z.number()])));
  const { tool, ran } = make(schema);
  const error = await errorOf(() => tool.run({}));
  expect(ran()).toBe(false);
  expect(error.message).toContain("field0");
  expect(error.message).toContain("42 more validation issues");
  expect(error.message.length).toBeLessThan(2048);
});

test("an individual validation message cannot dominate the tool result", async () => {
  const { tool, ran } = make(z.object({ value: z.string().refine(() => false, "x".repeat(5000)) }));
  const error = await errorOf(() => tool.run({ value: "invalid" }));
  expect(ran()).toBe(false);
  expect(error.message).toContain("value");
  expect(error.message.length).toBeLessThan(256);
});

test("valid tool input still reaches the implementation", async () => {
  const { tool, ran } = make(z.object({ positions: z.array(z.number()).max(100) }));
  expect(await tool.run({ positions: [1, 2] })).toBe("ok");
  expect(ran()).toBe(true);
});
