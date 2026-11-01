import { z } from "zod";
import { isKeyCode, keyCodeInfo } from "../../layout/keycodes.ts";
import { ModSchema } from "../../layout/schema.ts";

export const WORKLOAD_LIMITS = { fileBytes: 65_536, tasks: 32, outputsPerTask: 512, outputs: 4096, events: 4096, durationMs: 120_000 } as const;
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const WorkloadStrokeSchema = z.strictObject({
  key: z.string().refine((key) => isKeyCode(key) && !["modifier", "media", "mouse", "system"].includes(keyCodeInfo(key).category), "use a canonical non-modifier keyboard usage, not a system, mouse or consumer usage"),
  mods: z.array(ModSchema).max(8).refine((mods) => new Set(mods).size === mods.length, "duplicate modifiers"),
});
const witness = z.array(z.strictObject({
  at: z.number().int().min(0).max(WORKLOAD_LIMITS.durationMs),
  position: z.number().int().min(0).max(1023),
  action: z.enum(["press", "release"]),
})).min(2).max(WORKLOAD_LIMITS.events);
export const WorkloadTaskSchema = z.discriminatedUnion("kind", [
  z.strictObject({ id, kind: z.literal("text"), text: z.string().min(1).max(WORKLOAD_LIMITS.outputsPerTask), witness: witness.optional() }),
  z.strictObject({ id, kind: z.literal("hid"), strokes: z.array(WorkloadStrokeSchema).min(1).max(WORKLOAD_LIMITS.outputsPerTask), witness: witness.optional() }),
]);
export const WorkloadSuiteSchema = z.strictObject({
  schemaVersion: z.literal(1), id, host: z.literal("us-ansi"),
  tasks: z.array(WorkloadTaskSchema).min(1).max(WORKLOAD_LIMITS.tasks),
}).superRefine((suite, ctx) => {
  if (new Set(suite.tasks.map((t) => t.id)).size !== suite.tasks.length) ctx.addIssue({ code: "custom", message: "task IDs must be unique" });
  if (suite.tasks.reduce((n, t) => n + outputCount(t), 0) > WORKLOAD_LIMITS.outputs) ctx.addIssue({ code: "custom", message: "suite has too many outputs" });
});
export type WorkloadTask = z.infer<typeof WorkloadTaskSchema>;
export type WorkloadSuite = z.infer<typeof WorkloadSuiteSchema>;
export type WorkloadStroke = z.infer<typeof WorkloadStrokeSchema>;
export const outputCount = (task: WorkloadTask): number => task.kind === "text" ? [...task.text].length : task.strokes.length;

export const WorkloadPolicySchema = z.strictObject({
  maxExpansions: z.number().int().min(1).max(100_000).default(20_000),
  maxStates: z.number().int().min(1).max(128).default(64),
  maxRoutes: z.number().int().min(1).max(256).default(128),
  eventMs: z.number().int().min(1).max(50).default(10),
});
export type WorkloadPolicy = z.infer<typeof WorkloadPolicySchema>;
export const DEFAULT_WORKLOAD_POLICY: WorkloadPolicy = WorkloadPolicySchema.parse({});

/** Original tiny transcription samples, not representative activity frequencies. */
export function builtinWorkloadSuites(): WorkloadSuite[] {
  const texts = [
    ["prose", "we see a small tree.\n"], ["typescript", "const n = { value: 1 };\n"],
    ["python", "def add(a, b):\n\treturn a + b\n"], ["json", '{"ok": true, "n": 2}\n'],
    ["shell", "echo \"$HOME\" | cat\n"],
  ];
  return [
    ...texts.map(([name, text]) => WorkloadSuiteSchema.parse({ schemaVersion: 1, id: name, host: "us-ansi", tasks: [{ id: name, kind: "text", text }] })),
    WorkloadSuiteSchema.parse({ schemaVersion: 1, id: "shortcuts", host: "us-ansi", tasks: [
      { id: "copy-control", kind: "hid", strokes: [{ key: "C", mods: ["LCTL"] }] },
      { id: "command-palette", kind: "hid", strokes: [{ key: "P", mods: ["LGUI", "LSFT"] }] },
      { id: "navigation", kind: "hid", strokes: [{ key: "LEFT", mods: [] }, { key: "RIGHT", mods: [] }] },
    ] }),
  ];
}
