import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Self-contained server for the Docker image only, since `next start` does not
  // support it. Tracing starts at the repository
  // root because pnpm keeps the real packages in the root node_modules.
  output: process.env.NEXT_OUTPUT_STANDALONE === "true" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
