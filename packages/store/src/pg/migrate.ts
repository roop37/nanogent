import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectPostgres } from "./client.js";

const databaseUrl = process.env.NANOGENT_DATABASE_URL;
if (!databaseUrl) throw new Error("NANOGENT_DATABASE_URL is required");
const { pool, db } = connectPostgres(databaseUrl);
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  console.log("Migrations applied");
} catch {
  console.error("Database migration failed; check connectivity and migration permissions");
  process.exitCode = 1;
} finally {
  await pool.end();
}
