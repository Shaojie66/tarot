// 真实模型评测（需要 ANTHROPIC_API_KEY，会产生少量费用）：pnpm eval:live
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const envFile = fileURLToPath(new URL("./.env.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["evals/live/**/*.live.ts"],
    testTimeout: 15 * 60_000,
  },
});
