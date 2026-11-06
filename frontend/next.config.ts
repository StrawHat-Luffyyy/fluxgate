import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image. Tracing starts at the repository
  // root because pnpm keeps the real packages in the root node_modules.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
