import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_dnaruiydwcvmfbbyntay",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  build: {
    extensions: [
      additionalFiles({ files: ["../../prompts/system.md", "../../packages/sandbox/docker/*.py"] }),
    ],
  },
});
