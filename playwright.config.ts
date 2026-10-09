import { defineConfig, devices } from "@playwright/test";

const PORT = 3211;

// 默认用本机已装的 Google Chrome，免去下载浏览器；设 E2E_BROWSER_CHANNEL= （空）改用 Playwright 自带 Chromium。
const channel = process.env.E2E_BROWSER_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], ...(channel ? { channel } : {}) },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    port: PORT,
    timeout: 240_000,
    reuseExistingServer: false,
    // 强制无 key：验证"没有 API key 也能完整走通"。已存在的环境变量不会被 .env.local 覆盖。
    env: { ANTHROPIC_API_KEY: "" },
  },
});
