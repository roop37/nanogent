import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

export default defineConfig({
  ...base,
  test: {
    include: ["test/*.docker.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 300_000,
  },
});
