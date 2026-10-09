import { defineConfig, devices } from "@playwright/test";

const PORT = 3211;
// 对已经在跑的实例（如 Docker 容器）跑同一套用例：E2E_BASE_URL=http://127.0.0.1:3311 pnpm e2e。实例必须是无 key 的。
const external = process.env.E2E_BASE_URL;

// 默认用本机已装的 Google Chrome，免去下载浏览器；设 E2E_BROWSER_CHANNEL= （空）改用 Playwright 自带 Chromium。
const channel = process.env.E2E_BROWSER_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: external ?? `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    // 危机页默认地区按时区选；固定一个时区让断言稳定（具体地区切换另有用例）
    timezoneId: "Asia/Shanghai",
    // 默认不让 service worker 介入，保证其他用例的网络断言（page.route 等）行为不变；PWA 用例单独打开
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], ...(channel ? { channel } : {}) },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: `pnpm build && pnpm start --port ${PORT}`,
        port: PORT,
        timeout: 240_000,
        reuseExistingServer: false,
        // 强制无 key：验证"没有 API key 也能完整走通"。已存在的环境变量不会被 .env.local 覆盖。
        env: { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", AI_PROVIDER: "" },
      },
});
