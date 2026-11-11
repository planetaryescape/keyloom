import { z } from "zod";

// Setting up the MacBook remapper from the app (D-493), and opening System Settings at a named pane (D-492).
//   GET  /api/system/remapper?board=<boardId>       -> RemapperSetupResponse   (the doctor's findings, each with a code)
//   POST /api/system/remapper/install-kanata  {}    -> SetupActionResponse     (`brew install kanata`; waits for it)
//   POST /api/system/remapper/start  StartKanata    -> SetupActionResponse     (installs and starts the daemon through macOS's password dialog)
//   POST /api/system/open-settings   OpenSettings   -> SetupActionResponse     (400 schema for a pane not on the list; macOS only)

/** The panes keyloom opens. A name, never a URL: the server maps it (src/app/remapper-setup.ts). */
export const SettingsPaneSchema = z.enum(["input_monitoring", "accessibility", "files_and_folders", "full_disk_access", "login_items"]);
export type SettingsPaneName = z.infer<typeof SettingsPaneSchema>;

export const OpenSettingsRequestSchema = z.object({ pane: SettingsPaneSchema }).strict();
export type OpenSettingsRequest = z.infer<typeof OpenSettingsRequestSchema>;

export const StartKanataRequestSchema = z.object({ boardId: z.string().min(1) }).strict();

export const SetupFindingCodeSchema = z.enum([
  "kanata_missing", "kanata_version", "driver_missing", "driver_mismatch", "karabiner_elements", "keyboard_name", "karabiner_config",
  "permissions", "daemon_missing", "port_closed", "kbd_file",
]);
export type SetupFindingCode = z.infer<typeof SetupFindingCodeSchema>;

export const SetupFindingSchema = z.object({
  code: SetupFindingCodeSchema,
  name: z.string(),
  status: z.enum(["ok", "warn", "fail", "unknown"]),
  detail: z.string(),
});
export type SetupFinding = z.infer<typeof SetupFindingSchema>;

export const RemapperSetupResponseSchema = z.object({
  platform: z.enum(["darwin", "other"]),
  canInstall: z.boolean(),
  installing: z.boolean(),
  driverVersion: z.string().nullable(),
  findings: z.array(SetupFindingSchema),
});
export type RemapperSetupResponse = z.infer<typeof RemapperSetupResponseSchema>;

// A setup step that fails is not a bad request: the sentence is what the person reads, and the code is what the page acts on.
export const SetupActionResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), code: z.string().min(1), reason: z.string().min(1) }),
]);
export type SetupActionResponse = z.infer<typeof SetupActionResponseSchema>;
