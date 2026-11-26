import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  serverExternalPackages: [
    "@nanogent/controller",
    "@nanogent/store",
    "@neondatabase/serverless",
    "ws",
  ],
};
export default config;
