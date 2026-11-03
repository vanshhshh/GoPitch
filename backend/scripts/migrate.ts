/**
 * Applies sql/migrations/*.sql in filename order and records each in schema_migrations.
 *
 *   npx tsx scripts/migrate.ts            # apply pending migrations
 *   npx tsx scripts/migrate.ts --status   # list applied / pending, change nothing
 *
 * Every migration in this repo is written to be idempotent (IF NOT EXISTS / DROP ... IF
 * EXISTS), because the earlier ones were applied by hand with psql before this runner
 * existed — re-running them against such a database is a no-op. Each file runs in its own
 * transaction, so a failing migration leaves the database exactly as it was before it.
 */
import * as fs from "fs";
import * as path from "path";
import { pool } from "../src/lib/db";

const MIGRATIONS_DIR = path.join(__dirname, "..", "sql", "migrations");

export function listMigrationFiles(dir = MIGRATIONS_DIR): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function main() {
  const statusOnly = process.argv.includes("--status");
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  );
  const applied = new Set((await pool.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename));

  for (const file of listMigrationFiles()) {
    if (applied.has(file)) {
      console.log(`applied  ${file}`);
      continue;
    }
    if (statusOnly) {
      console.log(`pending  ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`migrated ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`FAILED   ${file}:`, (err as Error).message);
      process.exitCode = 1;
      return;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  main().finally(() => pool.end());
}
