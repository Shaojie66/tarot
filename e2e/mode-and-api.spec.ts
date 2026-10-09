// C1：模式选择与 API 边界。服务器为无 key 实例；"有 key"状态用 /api/status 路由替身模拟，
// 以便在浏览器里数 /api/rewrite、/api/reading 的实际请求。

import { expect, test, type Page } from "@playwright/test";

const MODEL_ROUTES = /\/api\/(rewrite|reading)$/;

async function pretendKeyed(page: Page) {
  const modelCalls: string[] = [];
  await page.route("**/api/status", (route) => route.fulfill({ json: { ai: true } }));
  await page.route(MODEL_ROUTES, (route) => {
    modelCalls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { type: "error", code: "unavailable" }, status: 503 });
  });
  return modelCalls;
}

async function openQuestion(page: Page, question: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "开始" }).click();
  await page.getByRole("button", { name: "自己写一个问题" }).click();
  await page.getByRole("button", { name: /^事业/ }).click();
  await page.getByLabel("你的问题").fill(question);
}

test("有 key + 全程本地：改写与解读接口都是 0 请求", async ({ page }) => {
  const modelCalls = await pretendKeyed(page);
  await openQuestion(page, "我在这份工作里到底想要什么？");
  await expect(page.getByText("问题会发送给模型 API 做改写")).toBeVisible();
  await page.getByRole("button", { name: "全程本地，不发送" }).click();

  // 不经过改写，直接进入抽牌
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
  await expect(page.getByText("AI 解读会把问题、自解和牌面发送给模型 API")).toBeVisible();
  await page.getByRole("button", { name: "本地解读", exact: true }).click();
  await expect(page.getByText("两种读法，哪个更像你？")).toBeVisible();
  expect(modelCalls).toEqual([]);
});

test("有 key + 选 AI 辅助：此时才发出改写请求", async ({ page }) => {
  const modelCalls = await pretendKeyed(page);
  await openQuestion(page, "我在这份工作里到底想要什么？");
  await page.getByRole("button", { name: "AI 辅助（会发送问题）" }).click();
  await expect(page.getByRole("button", { name: "快速抽牌" })).toBeVisible();
  expect(modelCalls).toEqual(["/api/rewrite"]);
});

test("API 拒绝 text/plain、跨站 Origin 和非回环 Host", async ({ request, baseURL }) => {
  const body = JSON.stringify({ question: "x", topic: "career" });
  const plain = await request.post("/api/rewrite", { headers: { "content-type": "text/plain" }, data: body });
  expect(plain.status()).toBe(415);

  const crossSite = await request.post("/api/rewrite", {
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    data: body,
  });
  expect(crossSite.status()).toBe(403);

  const lanHost = await request.post("/api/reading", {
    headers: { "content-type": "application/json", host: "192.168.1.20:3211" },
    data: "{}",
  });
  expect(lanHost.status()).toBe(403);

  // 同源 JSON 放行到业务校验（空 body → 400，而不是 403/415）
  const ok = await request.post("/api/reading", { headers: { "content-type": "application/json", origin: baseURL! }, data: "{}" });
  expect(ok.status()).toBe(400);
});
