import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export function connectPostgres(databaseUrl: string) {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("Invalid database URL");
  }
  const sslMode = url.searchParams.get("sslmode");
  const ssl = sslMode && sslMode !== "disable" ? { rejectUnauthorized: true } : undefined;
  if (ssl) {
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
  }
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ...(ssl && { ssl }),
    max: 24,
    connectionTimeoutMillis: 10_000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}
