import { z } from "zod";

export const ProposalArtifactSchema = z.object({
  kind: z.literal("proposal"),
  changeSetId: z.string().min(1),
  title: z.string().min(1),
});

export const ComparisonArtifactSchema = z.object({
  kind: z.literal("comparison"),
  title: z.string().min(1),
  options: z.array(z.object({
    title: z.string().min(1),
    changeSetId: z.string().min(1),
    gains: z.array(z.string()),
    costs: z.array(z.string()),
  })),
});

export const TransferArtifactSchema = z.object({
  kind: z.literal("transfer"),
  sourceBoard: z.string().min(1),
  destinationBoard: z.string().min(1),
  mappedCount: z.number().int().nonnegative(),
  skipped: z.array(z.object({
    key: z.string().min(1),
    reason: z.string().min(1),
  })),
});

export const KeyboardListArtifactSchema = z.object({
  kind: z.literal("keyboard_list"),
  keyboards: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    configs: z.array(z.string()),
    connected: z.boolean(),
  })),
});

export const KeyLocationsArtifactSchema = z.object({
  kind: z.literal("key_locations"),
  functionName: z.string().min(1),
  locations: z.array(z.object({
    layerId: z.string().min(1),
    layerName: z.string().min(1),
    position: z.number().int().nonnegative(),
    label: z.string().min(1),
  })),
});

export const FindingArtifactSchema = z.object({
  kind: z.literal("finding"),
  findings: z.array(z.object({
    finger: z.string().min(1),
    count: z.number().int().nonnegative(),
    suggestion: z.string().min(1),
  })),
});

export const ConfirmationArtifactSchema = z.object({
  kind: z.literal("confirmation"),
  planId: z.string().min(1),
  title: z.string().min(1),
  targets: z.array(z.string()),
  effects: z.array(z.string()),
  consequences: z.array(z.string()),
  status: z.enum(["pending", "approved", "cancelled"]),
});

export const ConfigResultArtifactSchema = z.object({
  kind: z.literal("config_result"),
  configId: z.string().min(1),
  name: z.string().min(1),
  boardId: z.string().min(1),
  action: z.enum(["created", "renamed", "archived", "restored", "deleted"]),
});

export const ImportReportArtifactSchema = z.object({
  kind: z.literal("import_report"),
  source: z.string().min(1),
  boardId: z.string().min(1),
  layerCount: z.number().int().nonnegative(),
  bindingCount: z.number().int().nonnegative(),
  unsupported: z.array(z.string()),
});

export const DiagnosticArtifactSchema = z.object({
  kind: z.literal("diagnostic"),
  findings: z.array(z.object({
    category: z.string().min(1),
    status: z.enum(["ok", "warning", "error"]),
    message: z.string().min(1),
  })),
});

export const DeviceOutcomeArtifactSchema = z.object({
  kind: z.literal("device_outcome"),
  device: z.string().min(1),
  outcome: z.string().min(1),
  verified: z.boolean(),
});

export const SafeExplanationArtifactSchema = z.object({
  kind: z.literal("safe_explanation"),
  text: z.string().min(1),
});

export const AgentArtifactSchema = z.discriminatedUnion("kind", [
  ProposalArtifactSchema,
  ComparisonArtifactSchema,
  TransferArtifactSchema,
  KeyboardListArtifactSchema,
  KeyLocationsArtifactSchema,
  FindingArtifactSchema,
  ConfirmationArtifactSchema,
  ConfigResultArtifactSchema,
  ImportReportArtifactSchema,
  DiagnosticArtifactSchema,
  DeviceOutcomeArtifactSchema,
  SafeExplanationArtifactSchema,
]);

export type AgentArtifact = z.infer<typeof AgentArtifactSchema>;
