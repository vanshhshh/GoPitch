import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

// Neon (and most managed Postgres) requires TLS. sslmode=require in the connection
// string doesn't fully self-configure node-postgres in all versions, so this sets it
// explicitly. rejectUnauthorized: false is standard for Neon's pooled connection setup
// (their certs chain through a CA node-postgres doesn't always resolve automatically) —
// the connection is still encrypted, this only skips strict CA chain validation.
const isNeonOrManaged = (process.env.DATABASE_URL || "").includes("sslmode=require");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isNeonOrManaged ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => {
  // A background/idle client error should never crash the whole API process
  console.error("Unexpected Postgres pool error:", err);
});

export async function withTransaction<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
