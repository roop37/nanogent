import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@nanogent/sandbox": fileURLToPath(
        new URL("../../packages/sandbox/src/index.ts", import.meta.url),
      ),
      "@nanogent/harness": fileURLToPath(
        new URL("../../packages/harness/src/index.ts", import.meta.url),
      ),
      "@nanogent/brain": fileURLToPath(
        new URL("../../packages/brain/src/index.ts", import.meta.url),
      ),
      "@nanogent/store": fileURLToPath(
        new URL("../../packages/store/src/index.ts", import.meta.url),
      ),
      "@nanogent/controller": fileURLToPath(
        new URL("../../packages/controller/src/index.ts", import.meta.url),
      ),
      "@nanogent/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@nanogent/config": fileURLToPath(
        new URL("../../packages/config/src/index.ts", import.meta.url),
      ),
    },
  },
  test: { exclude: ["**/node_modules/**", "**/dist/**", "**/*.docker.test.ts"] },
});
