import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  ...(process.env.NANOGENT_WEB_TEST_MODE === "1" ? { devIndicators: false as const } : {}),
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  serverExternalPackages: [
    "@nanogent/controller",
    "@nanogent/store",
    "@neondatabase/serverless",
    "ws",
  ],
};
export default config;
