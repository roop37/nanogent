import "server-only";
import { type PostgresRunStore, postgresSchema as schema } from "@nanogent/store";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

export async function withWebDatabase<T>(work: (db: PostgresRunStore["db"]) => Promise<T>) {
  const connectionString = process.env.NANOGENT_DATABASE_URL;
  if (!connectionString) throw new Error("Database is not configured");
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  try {
    return await work(drizzle(pool, { schema }));
  } finally {
    await pool.end();
  }
}
