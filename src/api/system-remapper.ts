import { z } from "zod";

// Setting up the MacBook remapper from the app (D-493), and opening System Settings at a named pane (D-492).
//   GET  /api/system/remapper?board=<boardId>       -> RemapperSetupResponse   (the doctor's findings, each with a code)
//   POST   /api/system/remapper/install-kanata  InstallKanata -> SetupActionResponse  (starts `brew install`, `upgrade` or `reinstall kanata`;
//                                                                                     the status read follows it; a second press joins it)
//   POST   /api/system/remapper/install-kanata/cancel  {}     -> SetupActionResponse  (cancels it; `not_running` when none runs)
//   POST /api/system/remapper/start  StartKanata    -> SetupActionResponse     (installs and starts the daemon through macOS's password dialog)
//   POST /api/system/remapper/restart  StartKanata  -> SetupActionResponse     (restarts the installed daemon through the password dialog, then
//                                                                               waits for kanata to answer; R11-02)
//   POST /api/system/remapper/log  {}               -> KanataLogResponse       (kanata's last log lines, read as root through the password dialog)
//   POST /api/system/open-settings   OpenSettings   -> SetupActionResponse     (400 schema for a pane not on the list; macOS only)

/** The panes keyloom opens. A name, never a URL: the server maps it (src/app/remapper-setup.ts). */
export const SettingsPaneSchema = z.enum(["input_monitoring", "accessibility", "files_and_folders", "full_disk_access", "login_items", "karabiner_elements", "docker_desktop"]);
export type SettingsPaneName = z.infer<typeof SettingsPaneSchema>;

export const OpenSettingsRequestSchema = z.object({ pane: SettingsPaneSchema }).strict();
export type OpenSettingsRequest = z.infer<typeof OpenSettingsRequestSchema>;

export const StartKanataRequestSchema = z.object({ boardId: z.string().min(1) }).strict();

/**
 * `download` is Get kanata on a Mac without Homebrew: keyloom downloads kanata's pinned release, checks its SHA-256 and keeps it in its own
 * folder (D-560). `upgrade` is Update kanata, for a kanata older than the one keyloom writes for (R2-10). `reinstall` puts Homebrew's own kanata back
 * over one that changed outside Homebrew (D-498).
 */
export const KanataInstallActionSchema = z.enum(["install", "upgrade", "reinstall", "download"]);
export type KanataInstallAction = z.infer<typeof KanataInstallActionSchema>;
export const InstallKanataRequestSchema = z.object({ action: KanataInstallActionSchema.optional() }).strict();
export type InstallKanataRequest = z.infer<typeof InstallKanataRequestSchema>;

export const SetupFindingCodeSchema = z.enum([
  "kanata_missing", "kanata_version", "driver_missing", "driver_mismatch", "karabiner_elements", "keyboard_name", "karabiner_config",
  "permissions", "daemon_missing", "port_closed", "kbd_file", "kanata_updated", "kanata_replaced", "daemon_outdated",
  "kanata_kept_changed",
]);
export type SetupFindingCode = z.infer<typeof SetupFindingCodeSchema>;

export const SetupFindingSchema = z.object({
  code: SetupFindingCodeSchema,
  name: z.string(),
  status: z.enum(["ok", "warn", "fail", "unknown"]),
  detail: z.string(),
});
export type SetupFinding = z.infer<typeof SetupFindingSchema>;

/**
 * The install or update started from the app (R2-06). This is its own small job, like R2-A's install-job API for Docker and Zapp
 * (src/app/tool-install.ts); the two can merge later. A finished job keeps its last state until the next one starts.
 */
export const KanataInstallSchema = z.object({
  state: z.enum(["idle", "running", "succeeded", "failed", "cancelled"]),
  action: KanataInstallActionSchema.nullable(),
  /** The last lines Homebrew, or Get kanata's download, printed, oldest first. */
  log: z.array(z.string()),
  failure: z.object({ code: z.string().min(1), reason: z.string().min(1) }).nullable(),
});
export type KanataInstall = z.infer<typeof KanataInstallSchema>;

export const RemapperSetupResponseSchema = z.object({
  platform: z.enum(["darwin", "other"]),
  /** Homebrew is here, so Install kanata and Update kanata can run. */
  canInstall: z.boolean(),
  /** keyloom can download kanata's pinned release for this Mac, so Get kanata can run (D-560). Optional for older servers. */
  canDownload: z.boolean().optional(),
  install: KanataInstallSchema,
  /**
   * The kanata on PATH and the version keyloom writes for. `update` says how to get that version: `brew` runs Update kanata (a Homebrew
   * kanata older than it), `link` is kanata's release page (also after an update that found nothing newer), and null means nothing to
   * update. `path` is where the kanata on PATH really is, and `copyVersion` the version of the root copy the daemon runs when the two
   * differ (D-498).
   */
  kanata: z.object({
    version: z.string().nullable(), wanted: z.string(), update: z.enum(["brew", "link"]).nullable(), path: z.string().nullable(), copyVersion: z.string().nullable(),
  }),
  driverVersion: z.string().nullable(),
  findings: z.array(SetupFindingSchema),
  /** The karabiner.json "devices" entry that frees the built-in keyboard, shown with Copy in the Karabiner step (R11-01). Absent from older senders. */
  karabinerEntry: z.string().min(1).optional(),
});
export type RemapperSetupResponse = z.infer<typeof RemapperSetupResponseSchema>;

// A setup step that fails is not a bad request: the sentence is what the person reads, and the code is what the page acts on.
export const SetupActionResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), code: z.string().min(1), reason: z.string().min(1) }),
]);
export type SetupActionResponse = z.infer<typeof SetupActionResponseSchema>;

/** kanata's last log lines (R11-02), or why keyloom couldn't read them: `cancelled`, `log_missing`, or `failed`. */
export const KanataLogResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), lines: z.array(z.string()) }),
  z.object({ ok: z.literal(false), code: z.string().min(1), reason: z.string().min(1) }),
]);
export type KanataLogResponse = z.infer<typeof KanataLogResponseSchema>;
