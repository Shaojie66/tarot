// PWA 离线矩阵（生产构建 + 真实 service worker，localhost 是安全上下文）：
//   首访（SW 未接管前）/ 已缓存后断网 / 断网刷新 / 断网走完本地流程并保存 / 未缓存页面 / API 不被缓存 / 版本更新与旧缓存清除 / 离线时 AI 不可用

import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

async function controlled(page: Page) {
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active && !!navigator.serviceWorker.controller;
  });
}

/** 首次访问：等 SW 装好、预缓存完成并接管。 */
async function warmUp(page: Page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // 接管后重载一次，让页面在 SW 控制下
  await controlled(page);
}

test("manifest 与图标可用，SW 注册成功", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", start_url: "/", lang: "zh-CN" });
  expect(manifest.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}${i.purpose ? `:${i.purpose}` : ""}`)).toEqual(["192x192", "512x512", "512x512:maskable"]);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  expect(sw.headers()["service-worker-allowed"]).toBe("/");
  await warmUp(page);
});

test("首访不是离线可用的：SW 接管前就断网会失败（符合预期，文档有说明）", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  await context.setOffline(true);
  await expect(page.goto("/")).rejects.toThrow();
  await context.close();
});

test("已缓存后断网：刷新、跨页面导航、历史页都能打开；本地流程能走完并保存", async ({ page, context }) => {
  await warmUp(page);
  await page.goto("/reading"); // 在线时访问过
  await page.goto("/");
  await context.setOffline(true);

  await page.reload();
  await expect(page.getByRole("link", { name: "开始" })).toBeVisible();

  // 客户端导航到预缓存页面
  await page.getByRole("link", { name: "开始" }).click();
  await expect(page.getByRole("heading", { name: "这一刻，想看看什么？" })).toBeVisible();

  // 离线走完本地流程：不依赖任何网络
  await page.getByRole("button", { name: "自己写一个问题" }).click();
  await page.getByRole("button", { name: /^事业/ }).click();
  await page.getByLabel("你的问题").fill("合成问题：离线也能用吗？");
  await page.getByRole("button", { name: "就问这个" }).click(); // 离线时 /api/status 失败 → 无 AI → 本地唯一路径
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
  await expect(page.getByText("没有配置 API key")).toBeVisible(); // AI 不可用的表现
  await expect(page.getByRole("button", { name: "AI 解读" })).toHaveCount(0);
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");

  // 离线硬刷新 /history：列表从 IndexedDB 读出
  await page.goto("/history");
  await expect(page.getByRole("link", { name: /离线也能用吗/ })).toBeVisible();

  // 离线打开每日一张 / 设置
  await page.goto("/daily");
  await expect(page.getByRole("button", { name: "抽今天的牌" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByTestId("ai-status")).toContainText("没有配置 API key");
});

test("没缓存过的页面离线时给出说明页，而不是浏览器错误", async ({ page, context }) => {
  await warmUp(page);
  await context.setOffline(true);
  await page.goto("/history/00000000000000000000000000000000");
  await expect(page.getByRole("heading", { name: "现在离线，这个页面还没缓存" })).toBeVisible();
  await expect(page.getByRole("link", { name: "回到首页" })).toBeVisible();
});

test("/api 响应不会被缓存；所有缓存里都没有 API 请求", async ({ page }) => {
  await warmUp(page);
  await page.goto("/settings"); // 会请求 /api/status
  await expect(page.getByTestId("ai-status")).not.toContainText("正在检查");
  const apiEntries = await page.evaluate(async () => {
    const hits: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) if (new URL(req.url).pathname.startsWith("/api/")) hits.push(req.url);
    }
    return hits;
  });
  expect(apiEntries).toEqual([]);
});

test("更新横幅：有新版本在等待时提示，用户点了才发 SKIP_WAITING，接管后才刷新（用桩替换 register 验证组件逻辑）", async ({ page }) => {
  // 真实浏览器里无法拦截 SW 脚本的更新请求，这里只验证页面侧逻辑；SW 自身的 install / activate / fetch 逻辑见 sw-source.test.ts
  await page.addInitScript(() => {
    const sw = new EventTarget() as EventTarget & { controller: unknown; register: unknown };
    const messages: unknown[] = [];
    const waiting = { postMessage: (m: unknown) => messages.push(m), state: "installed" };
    const registration = Object.assign(new EventTarget(), { waiting, installing: null, active: {} });
    Object.assign(sw, { controller: {}, register: async () => registration });
    Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true });
    (window as unknown as { __swMessages: unknown[]; __swFake: EventTarget }).__swMessages = messages;
    (window as unknown as { __swFake: EventTarget }).__swFake = sw;
    window.addEventListener("beforeunload", () => sessionStorage.setItem("reloaded", "1"));
  });
  await page.goto("/");
  await expect(page.getByTestId("pwa-update")).toBeVisible();
  // 没点之前什么都没发生
  expect(await page.evaluate(() => (window as unknown as { __swMessages: unknown[] }).__swMessages)).toEqual([]);
  // 接管（比如另一个标签页触发）不会让没确认的页面刷新
  await page.evaluate(() => (window as unknown as { __swFake: EventTarget }).__swFake.dispatchEvent(new Event("controllerchange")));
  expect(await page.evaluate(() => sessionStorage.getItem("reloaded"))).toBeNull();

  await page.getByRole("button", { name: "立即更新" }).click();
  expect(await page.evaluate(() => (window as unknown as { __swMessages: unknown[] }).__swMessages)).toEqual([{ type: "SKIP_WAITING" }]);
  await Promise.all([page.waitForEvent("load"), page.evaluate(() => (window as unknown as { __swFake: EventTarget }).__swFake.dispatchEvent(new Event("controllerchange")))]);
  expect(await page.evaluate(() => sessionStorage.getItem("reloaded"))).toBe("1");
});
