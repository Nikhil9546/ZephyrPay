import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
  turbopack: {
    root: "..",
  },
  // Semaphore ships Groth16 proving artifacts (wasm + zkey) that Next's
  // bundler shouldn't try to inline. Load them at runtime from node_modules.
  serverExternalPackages: [
    "@semaphore-protocol/proof",
    "@semaphore-protocol/group",
    "@semaphore-protocol/identity",
  ],
};

export default nextConfig;
