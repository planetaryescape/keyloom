// `keyloom doctor`: database checks only for now (10); toolchain checks arrive with builds.
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { MIGRATIONS } from "../persistence/migrations.ts";
import { databasePath, dataDir as resolveDataDir } from "../persistence/paths.ts";

export type DoctorCheck = { name: string; ok: boolean; detail: string };

export function runDoctor(opts: { dataDir?: string } = {}): DoctorCheck[] {
  const dir = resolveDataDir(opts.dataDir);
  const file = databasePath(dir);
  const checks: DoctorCheck[] = [{ name: "data directory", ok: true, detail: dir }];
  if (!existsSync(file)) {
    checks.push({ name: "database", ok: true, detail: `${file} does not exist yet; it is created by the first import` });
    return checks;
  }
  // Read-only: doctor must not create or migrate anything.
  let db: Database | undefined;
  try {
    db = new Database(file, { readonly: true, strict: true });
    const integrity = (db.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    checks.push({ name: "database integrity", ok: integrity === "ok", detail: integrity });
    const mode = (db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
    checks.push({ name: "journal mode", ok: mode === "wal", detail: mode });
    const row = db.query("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
    const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
    checks.push({
      name: "migrations",
      ok: row.v === latest,
      detail: row.v === latest ? `at version ${latest}` : `database is at ${row.v ?? "none"}, this keyloom expects ${latest}`,
    });
    const layouts = db.query("SELECT COUNT(*) AS n FROM layouts").get() as { n: number };
    checks.push({ name: "layouts", ok: true, detail: String(layouts.n) });
  } catch (err) {
    checks.push({ name: "database", ok: false, detail: (err as Error).message });
  } finally {
    db?.close();
  }
  return checks;
}
