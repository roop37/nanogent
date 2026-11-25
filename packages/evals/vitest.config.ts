import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@nanogent/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@nanogent/sandbox": fileURLToPath(new URL("../sandbox/src/index.ts", import.meta.url)),
    },
  },
  test: { exclude: ["**/node_modules/**", "**/dist/**", "**/*.docker.test.ts"] },
});
