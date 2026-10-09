import type { NextConfig } from "next";

// 构建号：service worker 的缓存版本。同一次构建里服务端与 sw.js 必须一致。
const buildId = process.env.TAROT_BUILD_ID ?? new Date().toISOString().replace(/\D/g, "").slice(0, 14);

const nextConfig: NextConfig = {
  generateBuildId: async () => buildId,
  env: { TAROT_BUILD_ID: buildId },
  // Docker 镜像用 standalone 输出；本机 `pnpm build && pnpm start` 保持默认
  ...(process.env.TAROT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
