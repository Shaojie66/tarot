// C3：AI 浏览器链路（API 用路由替身，服务器仍是无 key 实例）。
// 覆盖：取消后立即重试、迟到的旧请求事件不影响新会话、离开页面中止请求、双击只发一次、
// 非 200 与畸形 NDJSON 的错误映射。

import { expect, test, type Page, type Route } from "@playwright/test";

interface Held {
  route: Route;
  body: { cards: { cardId: string; position: number; reversed: boolean }[] };
  release: (ndjson: string) => Promise<void>;
}

function resultEvent(cards: Held["body"]["cards"]) {
  return {
    type: "result",
    result: {
      source: "ai",
      overall: "这是替身服务返回的整体解读。",
      cards: cards.map((c) => ({ ...c, text: "这张牌在这个位置上的替身解读。" })),
      interpretations: ["读法一：从处境看。", "读法二：从感受看。"],
      action: "今晚写下三件让你累的事",
      question: "如果不用立刻决定，你最想先弄清楚什么？",
    },
    versions: { content: "test", prompt: "v2", model: "mock" },
  };
}

const lines = (...events: object[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

async function setup(page: Page) {
  const readingCalls: Held[] = [];
  await page.route("**/api/status", (r) => r.fulfill({ json: { ai: true } }));
  await page.route("**/api/rewrite", (r) => r.fulfill({ json: { type: "error", code: "unavailable" }, status: 503 }));
  return readingCalls;
}

/** 拦截 /api/reading：每个请求挂起，由测试决定何时、以什么内容响应。 */
async function holdReading(page: Page, calls: Held[]) {
  await page.route("**/api/reading", (route) => {
    const body = route.request().postDataJSON();
    calls.push({
      route,
      body,
      release: (ndjson) => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: ndjson }),
    });
  });
}

async function reachReadingStep(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "开始" }).click();
  await page.getByRole("button", { name: /^事业/ }).click();
  await page.getByLabel("你的问题").fill("我在这份工作里到底想要什么？");
  await page.getByRole("button", { name: "AI 辅助（会发送问题）" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
}

test("取消后立即重试：旧请求迟到的危机事件不会清掉新会话", async ({ page }) => {
  const calls = await setup(page);
  await holdReading(page, calls);
  await reachReadingStep(page);

  await page.getByRole("button", { name: "AI 解读", exact: true }).click();
  await expect.poll(() => calls.length).toBe(1);
  await page.getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: "重试 AI 解读" }).click();
  await expect.poll(() => calls.length).toBe(2);

  // 新请求先完成
  await calls[1].release(lines(resultEvent(calls[1].body.cards)));
  await expect(page.getByText("两种读法，哪个更像你？")).toBeVisible();

  // 旧请求此时才到：危机事件不能改变当前结果（旧的 fetch 已被客户端中止，这里模拟服务端迟到）
  await calls[0].release(lines({ type: "crisis" })).catch(() => {});
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: "这一刻，先不抽牌了。" })).toHaveCount(0);
  await expect(page.getByText("两种读法，哪个更像你？")).toBeVisible();
  expect(calls).toHaveLength(2);
});

test("生成中离开页面（客户端导航）会中止请求", async ({ page }) => {
  const calls = await setup(page);
  await holdReading(page, calls);
  const failed: string[] = [];
  page.on("requestfailed", (r) => r.url().includes("/api/reading") && failed.push(r.failure()?.errorText ?? ""));
  await reachReadingStep(page);

  await page.getByRole("button", { name: "AI 解读", exact: true }).click();
  await expect.poll(() => calls.length).toBe(1);
  await page.getByRole("link", { name: "牌义百科" }).click();
  await expect(page).toHaveURL(/\/cards/);
  await expect.poll(() => failed.length).toBe(1);
});

test("双击“AI 解读”只发出一个请求", async ({ page }) => {
  const calls = await setup(page);
  await holdReading(page, calls);
  await reachReadingStep(page);

  await page.getByRole("button", { name: "AI 解读", exact: true }).dblclick();
  await page.waitForTimeout(400);
  expect(calls).toHaveLength(1);
});

test.describe("错误映射", () => {
  test("403 → 本机服务拒绝", async ({ page }) => {
    await setup(page);
    await reachReadingStepWithRoutes(page, (route) =>
      route.fulfill({ status: 403, json: { type: "error", code: "forbidden" } }),
    );
    await expect(page.getByRole("alert").filter({ hasText: "请求被本机服务拒绝" })).toBeVisible();
  });

  test("畸形 NDJSON 行 → 协议错误，不当作断网", async ({ page }) => {
    await setup(page);
    await reachReadingStepWithRoutes(page, (route) =>
      route.fulfill({ status: 200, contentType: "application/x-ndjson", body: "{not json\n" }),
    );
    await expect(page.getByRole("alert").filter({ hasText: "服务返回的数据格式不对" })).toBeVisible();
  });

  test("503 → 不可用，而不是笼统的“出了点问题”", async ({ page }) => {
    await setup(page);
    await reachReadingStepWithRoutes(page, (route) =>
      route.fulfill({ status: 503, json: { type: "error", code: "unavailable" } }),
    );
    await expect(page.getByRole("alert").filter({ hasText: "没有配置 API key" })).toBeVisible();
  });

  test("断流（没有终止事件）→ 网络中断", async ({ page }) => {
    await setup(page);
    await reachReadingStepWithRoutes(page, (route) =>
      route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines({ type: "section", key: "overall", value: "一段" }) }),
    );
    await expect(page.getByRole("alert").filter({ hasText: "连接中断了" })).toBeVisible();
  });
});

async function reachReadingStepWithRoutes(page: Page, handler: (route: Route) => Promise<void>) {
  await page.route("**/api/reading", handler);
  await reachReadingStep(page);
  await page.getByRole("button", { name: "AI 解读", exact: true }).click();
}
