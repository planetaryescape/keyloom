// `keyloom version` (25, 10#commands): a config's versions, the revisions that went onto the keyboard, and what to do with them.
import type { Command } from "commander";
import {
  type CompareView, type VersionView, compareRevision, nameVersion, restoreVersion, versionHistory,
} from "../../app/index.ts";
import { SCHEMA_VERSION, columns, print } from "../output.ts";
import type { CliContext } from "./context.ts";

const when = (ms: number | null): string => (ms === null ? "-" : new Date(ms).toISOString());

function formatStayDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

const staySeconds = (v: VersionView): number | null => {
  if (v.putOnAt === null) return null;
  const end = v.endedAt ?? (v.current ? Date.now() : null);
  return end === null ? null : Math.max(0, Math.round((end - v.putOnAt) / 1000));
};

const versionJson = (v: VersionView) => {
  const stay_seconds = staySeconds(v);
  return {
    id: v.id, revision_id: v.revisionId, name: v.name, put_on_at: v.putOnAt, ended_at: v.endedAt,
    stay_seconds, stay_label: formatStayDuration(stay_seconds),
    current: v.current, summary: v.summary, created_at: v.createdAt,
  };
};

const compareJson = (c: CompareView) => ({
  layout_id: c.layoutId,
  from: { revision_id: c.from.id, summary: c.from.summary, created_at: c.from.createdAt },
  to: { revision_id: c.to.id, summary: c.to.summary, created_at: c.to.createdAt },
  same: c.diff.same,
  keys: c.diff.keys.map((k) => ({
    layer_id: k.layerId, layer_name: k.layerName, position: k.position, before: k.before, after: k.after, before_label: k.beforeLabel, after_label: k.afterLabel,
  })),
  layers_added: c.diff.layersAdded, layers_removed: c.diff.layersRemoved, layers_renamed: c.diff.layersRenamed, layers_reordered: c.diff.layersReordered,
  lighting: c.diff.lighting, macros: c.diff.macros, tap_dances: c.diff.tapDances, combos: c.diff.combos, hold_tap_profiles: c.diff.holdTapProfiles,
  settings: c.diff.settings, passthrough: c.diff.passthrough,
});

const list = (label: string, xs: string[]) => (xs.length > 0 ? [`${label}: ${xs.join(", ")}`] : []);

function compareTable(c: CompareView): string {
  const d = c.diff;
  if (d.same) return `${c.from.id} is the same as the head ${c.to.id}`;
  const one = d.keys.length === 1;
  const lines = [`${c.from.id} (then) compared with ${c.to.id} (now): ${d.keys.length} key${one ? "" : "s"} ${one ? "differs" : "differ"}`];
  if (d.keys.length > 0) lines.push(columns([["LAYER", "KEY", "THEN", "NOW"], ...d.keys.map((k) => [k.layerName, String(k.position + 1), k.beforeLabel, k.afterLabel])]));
  const named = (n: { added: string[]; removed: string[]; changed: string[] }) => [...n.added.map((x) => `+${x}`), ...n.removed.map((x) => `-${x}`), ...n.changed.map((x) => `~${x}`)];
  lines.push(
    ...list("layers added", d.layersAdded.map((l) => l.name)), ...list("layers removed", d.layersRemoved.map((l) => l.name)),
    ...list("layers renamed", d.layersRenamed.map((l) => `${l.from} -> ${l.to}`)), ...(d.layersReordered ? ["layers reordered"] : []),
    ...list("lighting changed on", d.lighting), ...list("macros", named(d.macros)), ...list("tap dances", named(d.tapDances)),
    ...list("combos", named(d.combos)), ...list("hold-tap profiles", named(d.holdTapProfiles)),
    ...list("settings", d.settings.map((s) => `${s.key} ${s.before ?? "unset"} -> ${s.after ?? "unset"}`)), ...(d.passthrough ? ["firmware source kept as written differs"] : []),
  );
  return lines.join("\n");
}

export function registerVersionCommands(program: Command, ctx: CliContext & { quiet: () => boolean }): void {
  const { io, format, withApp, quiet } = ctx;
  const version = program.command("version").description("a config's versions: what went on the keyboard and when, naming them, going back and comparing");

  version
    .command("list")
    .description("versions newest first, each with the revisions made since the one before it; revisions newer than the newest version are listed first as not yet on a keyboard")
    .argument("<config>", "config ID or name")
    .option("--json", "print JSON, whatever the output format")
    .action(async (ref: string, opts: { json?: boolean }) => {
      const h = await withApp((app) => versionHistory(app, ref));
      const brief = (r: { id: string; origin: string; summary: string; createdAt: number }) => ({ revision_id: r.id, origin: r.origin, summary: r.summary, created_at: r.createdAt });
      const lines: string[] = [];
      if (h.pending.length > 0) lines.push(`not on a keyboard yet (${h.pending.length})`, ...h.pending.map((r) => `  ${r.id}  ${r.summary}`));
      for (const m of h.versions) {
        const v = m.version;
        const stay = formatStayDuration(staySeconds(v));
        const span = v.putOnAt === null ? "named, never put on" : v.current ? `on the keyboard since ${when(v.putOnAt)} (${stay})` : `on ${when(v.putOnAt)} to ${when(v.endedAt)} (${stay})`;
        lines.push(`${v.id}  ${v.name ?? "(unnamed)"}  ${span}`, `  ${v.revisionId}  ${v.summary}`, ...m.revisions.map((r) => `    ${r.id}  ${r.summary}`));
      }
      const fmt = opts.json ? "json" : format();
      print(io, fmt, {
        json: { layout_id: h.layoutId, head_revision_id: h.headRevisionId, pending: h.pending.map(brief), versions: h.versions.map((m) => ({ ...versionJson(m.version), revisions: m.revisions.map(brief) })) },
        rows: h.versions.map((m) => ({ schema_version: SCHEMA_VERSION, ...versionJson(m.version), revisions: m.revisions.map(brief) })),
        ids: h.versions.map((m) => m.version.id),
        table: lines.length === 0 ? `${h.layoutName} has no versions yet; one is recorded when a sync is verified on the keyboard` : lines.join("\n"),
      });
    });

  version
    .command("name")
    .description("name a revision (or a version) as a version, with or without it ever going on the keyboard; an empty name clears it")
    .argument("<config>", "config ID or name")
    .argument("<target>", "a revision ID, a version ID or a version's name")
    .argument("<name>", "the name, such as \"before the HRM tweak\"")
    .option("--json", "print JSON, whatever the output format")
    .action(async (ref: string, target: string, name: string, opts: { json?: boolean }) => {
      const v = await withApp((app) => nameVersion(app, ref, target, name));
      const fmt = opts.json ? "json" : format();
      print(io, fmt, {
        json: { version: v && versionJson(v) },
        ids: v ? [v.id] : [],
        table: quiet() ? (v?.id ?? "") : v ? `${v.id}\n${v.revisionId} is named "${v.name}"` : "the name is cleared",
      });
    });

  version
    .command("restore")
    .description("go back to a version as a new revision (the same as `undo --to`), refusing one that breaks a rule the head doesn't; the keyboard changes only when it syncs")
    .argument("<config>", "config ID or name")
    .argument("<target>", "a version ID, a version's name or a revision ID")
    .option("--json", "print JSON, whatever the output format")
    .action(async (ref: string, target: string, opts: { json?: boolean }) => {
      const out = await withApp((app) => restoreVersion(app, ref, target));
      const fmt = opts.json ? "json" : format();
      print(io, fmt, {
        json: { revision_id: out.revision.id, restored_revision_id: out.restoredRevisionId },
        ids: [out.revision.id],
        table: quiet()
          ? out.revision.id
          : `${out.revision.id}\n${out.revision.summary}`,
      });
    });

  version
    .command("compare")
    .description("what differs between a version (or any revision) and the head, key by key")
    .argument("<config>", "config ID or name")
    .argument("<target>", "a version ID, a version's name or a revision ID")
    .action(async (ref: string, target: string) => {
      const c = await withApp((app) => compareRevision(app, ref, target));
      print(io, format(), { json: compareJson(c), ids: [c.from.id], table: compareTable(c) });
    });
}
