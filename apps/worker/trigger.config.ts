import { additionalFiles, syncEnvVars } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

// Variables copied from the deploying shell into the Trigger.dev environment at deploy time.
// Nothing is read from files; unset variables are skipped.
const WORKER_ENV = [
  "NANOGENT_DATABASE_URL",
  "NANOGENT_ANTHROPIC_API_KEY",
  "DAYTONA_API_KEY",
  "NANOGENT_ENV",
] as const;

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_dnaruiydwcvmfbbyntay",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  build: {
    extensions: [
      additionalFiles({ files: ["../../prompts/system.md", "../../packages/sandbox/docker/*.py"] }),
      syncEnvVars(() =>
        WORKER_ENV.flatMap((name) => {
          const value = process.env[name];
          return value ? [{ name, value }] : [];
        }),
      ),
    ],
  },
});
