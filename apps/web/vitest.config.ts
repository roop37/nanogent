import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@nanogent/store": fileURLToPath(
        new URL("../../packages/store/src/index.ts", import.meta.url),
      ),
      "@nanogent/controller/remote": fileURLToPath(
        new URL("../../packages/controller/src/remote.ts", import.meta.url),
      ),
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "@nanogent/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@nanogent/config": fileURLToPath(
        new URL("../../packages/config/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
