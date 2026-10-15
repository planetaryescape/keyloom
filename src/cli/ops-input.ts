// Reads the `--ops <file|->` argument of the change commands.
import { z } from "zod";
import { type ChangeOp, ChangeOpSchema, UsageError } from "../app/index.ts";

const OpsFileSchema = z.union([z.array(ChangeOpSchema), z.object({ ops: z.array(ChangeOpSchema) })]);

/** `source` is a file path, or `-` for stdin. The JSON is an array of ops, or `{ "ops": [...] }`. */
export async function readOps(source: string): Promise<ChangeOp[]> {
  let text: string;
  try {
    text = source === "-" ? await Bun.stdin.text() : await Bun.file(source).text();
  } catch {
    throw new UsageError(`can't read ops from ${source === "-" ? "stdin" : source}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`ops are not valid JSON: ${(err as Error).message}`);
  }
  const parsed = OpsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "ops"}: ${i.message}`).join("; ");
    throw new UsageError(`ops don't match the change op schema: ${where}`);
  }
  const ops = Array.isArray(parsed.data) ? parsed.data : parsed.data.ops;
  if (ops.length === 0) throw new UsageError("ops is empty; there is nothing to change");
  return ops;
}
