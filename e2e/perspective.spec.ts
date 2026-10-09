// 换个视角：用路由替身模拟 /api/status 与 /api/perspective（服务器仍是无 key 实例），
// 验证请求次数、原记录不被改动、失败 / 危机路径与备份。

import { expect, test, type Page } from "@playwright/test";

const Q = "合成问题：我想要什么样的工作？";

const body = (tone: string) => ({
  type: "ok",
  body: {
    overall: `合成${tone}视角：你已经在认真对待这件事。`,
    interpretations: [`合成${tone}读法甲：休息也是一种答案。`, `合成${tone}读法乙：先回答最小的那个问题。`],
    question: `合成${tone}：你最想先弄清楚什么？`,
  },
  versions: { content: "test", prompt: "v3", model: "mock-deep" },
});

async function openSavedRecord(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "开始" }).click();
  await page.getByRole("button", { name: /^事业/ }).click();
  await page.getByLabel("你的问题").fill(Q);
  await page.getByRole("button", { name: /^(就问这个|全程本地)/ }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
  await page.getByRole("button", { name: "本地解读", exact: true }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  await page.getByTestId("open-record").click();
  await expect(page.getByRole("heading", { name: Q })).toBeVisible();
}

async function withAi(page: Page, handler: (tone: string, call: number) => { status?: number; json: unknown } | "hang") {
  const calls: string[] = [];
  await page.route("**/api/status", (r) => r.fulfill({ json: { ai: true } }));
  await page.route("**/api/perspective", async (route) => {
    const { tone } = route.request().postDataJSON() as { tone: string };
    calls.push(tone);
    const out = handler(tone, calls.length);
    if (out === "hang") return; // 挂起，由测试决定后续
    await route.fulfill({ status: out.status ?? 200, json: out.json });
  });
  return calls;
}

test("无 key：提示需要 AI，不显示视角按钮", async ({ page }) => {
  await openSavedRecord(page);
  await expect(page.getByText("换视角需要 AI")).toBeVisible();
  await expect(page.getByRole("button", { name: "温和支持" })).toHaveCount(0);
});

test("换视角：另存一份快照，原解读 / 小行动 / 选择不变；每种语气只请求一次；刷新后仍在", async ({ page }) => {
  const calls = await withAi(page, (tone) => ({ json: body(tone) }));
  await openSavedRecord(page);
  const originalOverall = await page.locator("#snapshot-title + p").innerText();
  const decisionBefore = await page.getByTestId("action-decision").innerText();

  // 双击只发一次
  await page.getByRole("button", { name: "温和支持" }).dblclick();
  await expect(page.getByTestId("perspective-support")).toBeVisible();
  expect(calls).toEqual(["support"]);
  await expect(page.getByTestId("perspective-support")).toContainText("换视角 · 温和支持 · AI");
  await expect(page.getByRole("button", { name: "温和支持" })).toHaveCount(0); // 已有，不再提供

  // 原内容没变
  expect(await page.locator("#snapshot-title + p").innerText()).toBe(originalOverall);
  expect(await page.getByTestId("action-decision").innerText()).toBe(decisionBefore);

  await page.getByRole("button", { name: "理性拆解" }).click();
  await expect(page.getByTestId("perspective-rational")).toBeVisible();
  await page.getByRole("button", { name: "挑战提问" }).click();
  await expect(page.getByText("三种视角都看过了")).toBeVisible();
  expect(calls).toEqual(["support", "rational", "challenge"]);

  await page.reload();
  await expect(page.getByTestId("perspective-support")).toBeVisible();
  await expect(page.getByTestId("perspective-challenge")).toBeVisible();
});

test("请求里带着已给过的读法；失败时原记录不变且可重试", async ({ page }) => {
  let attempt = 0;
  await page.route("**/api/status", (r) => r.fulfill({ json: { ai: true } }));
  const payloads: { previous: string[] }[] = [];
  await page.route("**/api/perspective", async (route) => {
    payloads.push(route.request().postDataJSON());
    attempt++;
    if (attempt === 1) return route.fulfill({ status: 200, json: { type: "error", code: "invalid_output" } });
    return route.fulfill({ json: body("support") });
  });
  await openSavedRecord(page);
  await page.getByRole("button", { name: "温和支持" }).click();
  await expect(page.getByTestId("perspective-error")).toContainText("这次生成的结果不合格");
  await expect(page.getByTestId("perspective-error")).toContainText("原来的解读没有变化");
  await expect(page.getByTestId("perspective-support")).toHaveCount(0);
  expect(payloads[0].previous).toHaveLength(2);

  await page.getByRole("button", { name: "温和支持" }).click();
  await expect(page.getByTestId("perspective-support")).toBeVisible();
});

test("危机命中：显示求助资源，不保存视角", async ({ page }) => {
  await withAi(page, () => ({ json: { type: "crisis" } }));
  await openSavedRecord(page);
  await page.getByRole("button", { name: "理性拆解" }).click();
  await expect(page.getByRole("heading", { name: "这一刻，先不抽牌了。" })).toBeVisible();
  await page.getByRole("button", { name: "返回这条记录" }).click();
  await expect(page.getByTestId("perspective-rational")).toHaveCount(0);
});

test("取消：请求被中止，原记录不变", async ({ page }) => {
  await withAi(page, () => "hang");
  await openSavedRecord(page);
  await page.getByRole("button", { name: "挑战提问" }).click();
  await expect(page.getByRole("button", { name: "挑战提问生成中…" })).toBeDisabled();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: "挑战提问", exact: true })).toBeEnabled();
  await expect(page.getByTestId("perspective-challenge")).toHaveCount(0);
});

test("分享图不含换视角内容", async ({ page }) => {
  await withAi(page, (tone) => ({ json: body(tone) }));
  await openSavedRecord(page);
  await page.getByRole("button", { name: "温和支持" }).click();
  await expect(page.getByTestId("perspective-support")).toBeVisible();
  await page.getByRole("button", { name: "生成预览" }).click();
  const contents = await page.getByTestId("share-contents").innerText();
  expect(contents).not.toContain("合成");
  expect(contents).not.toContain("换视角");
});
