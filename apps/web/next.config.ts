import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@typing-trainer/engine", "@typing-trainer/content"],
};

export default nextConfig;
