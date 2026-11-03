/**
 * In-process Postgres (PGlite) for integration tests: no Docker, no network, and never
 * the real database. Applies sql/schema.sql followed by every migration, exactly as a
 * fresh deployment would, so the tests double as migration validation.
 *
 * Exposes a `pool` shim with the subset of node-postgres the app uses (query / connect /
 * release / on). Everything runs on one PGlite connection, which is fine for sequential
 * tests; it cannot reproduce cross-connection concurrency (advisory locks are re-entrant
 * within a session), so lock contention is covered by unit tests instead.
 */
import * as fs from "fs";
import * as path from "path";
import { PGlite } from "@electric-sql/pglite";

const SQL_DIR = path.join(__dirname, "..", "..", "sql");

let instance: PGlite | null = null;
let ready: Promise<PGlite> | null = null;

export function migrationFiles(): string[] {
  return fs.readdirSync(path.join(SQL_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
}

export async function applySchemaAndMigrations(db: PGlite, times = 1) {
  // pgcrypto isn't bundled with PGlite; gen_random_uuid() is core since Postgres 13.
  const schema = fs.readFileSync(path.join(SQL_DIR, "schema.sql"), "utf-8").replace(/CREATE EXTENSION[^;]*;/gi, "");
  await db.exec(schema);
  for (let i = 0; i < times; i++) {
    for (const file of migrationFiles()) {
      await db.exec(fs.readFileSync(path.join(SQL_DIR, "migrations", file), "utf-8"));
    }
  }
}

export function getTestDb(): Promise<PGlite> {
  if (!ready) {
    ready = (async () => {
      instance = new PGlite();
      await applySchemaAndMigrations(instance);
      return instance;
    })();
  }
  return ready;
}

async function run(text: string, params?: any[]) {
  const db = await getTestDb();
  const result = await db.query<any>(text, params ?? []);
  return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
}

const client = { query: run, release: () => {} };

export const pool = {
  query: run,
  connect: async () => client,
  on: () => {},
  end: async () => {},
};

/** Mirrors lib/db.ts withUserLock using the shim (real advisory-lock SQL, single session). */
export async function withUserLock<T>(scope: string, userId: string, fn: (c: any) => Promise<T>) {
  const key = `${scope}:${userId}`;
  const lock = await run("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [key]);
  if (!lock.rows[0]?.ok) return { acquired: false as const };
  try {
    return { acquired: true as const, result: await fn(client) };
  } finally {
    await run("SELECT pg_advisory_unlock(hashtext($1))", [key]);
  }
}

export async function withTransaction<T>(fn: (c: any) => Promise<T>): Promise<T> {
  await run("BEGIN");
  try {
    const result = await fn(client);
    await run("COMMIT");
    return result;
  } catch (err) {
    await run("ROLLBACK");
    throw err;
  }
}
