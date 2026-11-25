import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";
export default defineConfig({
  ...base,
  test: {
    include: ["test/*.docker.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
