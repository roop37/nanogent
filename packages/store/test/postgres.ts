import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectPostgres } from "../src/pg/client.js";
import { PostgresRunStore } from "../src/pg/store.js";

const exec = promisify(execFile);
const docker = (args: string[]) =>
  exec("docker", args, {
    timeout: 120_000,
    maxBuffer: 100_000,
    env: {
      NODE_ENV: "test",
      ...Object.fromEntries(
        ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"].flatMap((key) =>
          process.env[key] ? [[key, process.env[key]]] : [],
        ),
      ),
    },
  });
export const dockerAvailable = await docker(["info", "--format", "{{.ServerVersion}}"]).then(
  () => true,
  () => false,
);

export async function startPostgres() {
  const name = `nanogent-pg-test-${crypto.randomUUID()}`;
  let connection: ReturnType<typeof connectPostgres> | undefined;
  const stop = async () => {
    await connection?.pool.end();
    await docker(["rm", "-f", name]);
  };
  try {
    try {
      await docker(["image", "inspect", "postgres:17-alpine"]);
    } catch {
      await docker(["pull", "postgres:17-alpine"]);
    }
    await docker([
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-p",
      "127.0.0.1::5432",
      "postgres:17-alpine",
    ]);
    const { stdout } = await docker(["port", name, "5432/tcp"]);
    const port = Number(stdout.trim().split(":").at(-1));
    const url = `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
    connection = connectPostgres(url);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await connection.pool.query("select 1");
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready) throw new Error("Postgres test container did not become ready");
    await migrate(connection.db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    return {
      ...connection,
      url,
      store: new PostgresRunStore(connection.db, ["synthetic-secret"]),
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
