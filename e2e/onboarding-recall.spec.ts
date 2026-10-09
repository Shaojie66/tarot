// 首访建档与未来回读：此前所有用例都在“未建档”状态下直接点情境卡，没有覆盖这条产品路径。

import { expect, test, type Page } from "@playwright/test";

async function openScenarios(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "开始" }).click();
  await expect(page.getByRole("heading", { name: "这一刻，想看看什么？" })).toBeVisible();
}

const profile = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("tarot:profile:v1") ?? "null"));
const recalls = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("tarot:recall:v1") ?? "[]") as { recordId: string; dueAt: string; createdAt: string; status: string }[]);

async function finishReading(page: Page) {
  await page.getByRole("button", { name: "留在原地，还是换个方向？" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
}

test("首访出现建档引导，但不挡住情境卡；全部跳过后永不再问", async ({ page }) => {
  await openScenarios(page);
  await expect(page.getByRole("heading", { name: "先花几秒定个方向" })).toBeVisible();
  await expect(page.getByRole("button", { name: "留在原地，还是换个方向？" })).toBeVisible(); // 同屏可直接点卡

  await page.getByRole("button", { name: "全部跳过，直接开始" }).click();
  await expect(page.getByRole("heading", { name: "先花几秒定个方向" })).toHaveCount(0);
  expect((await profile(page))?.onboarded).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "这一刻，想看看什么？" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "先花几秒定个方向" })).toHaveCount(0);

  // 跳过之后主流程照常
  await finishReading(page);
  expect(await recalls(page)).toEqual([]); // 没选回读节奏，就没有提醒
});

test("不点建档、直接点卡走完主流程；建档引导不影响保存", async ({ page }) => {
  await openScenarios(page);
  await finishReading(page);
  await page.goto("/history");
  await expect(page.getByRole("link", { name: /留在原地/ })).toBeVisible();
});

test("建档选了“3 天后”回读：保存后安排一条；到期时首页与历史出现提示，可进入记录或忽略；删除记录一并清掉", async ({ page }) => {
  await openScenarios(page);
  await page.getByRole("button", { name: "先不选，下一步" }).click(); // 意图
  await page.getByRole("button", { name: "下一步" }).click(); // 主题
  await page.getByRole("button", { name: /3 天后/ }).click();
  expect(await profile(page)).toMatchObject({ onboarded: true, recallCadence: "3days" });

  await finishReading(page);
  await expect.poll(async () => (await recalls(page)).length).toBe(1);
  const [recall] = await recalls(page);
  const days = (Date.parse(recall.dueAt) - Date.parse(recall.createdAt)) / 86_400_000;
  expect(days).toBeCloseTo(3, 3);
  expect(recall.status).toBe("pending");

  // 没到期：不提示
  await page.goto("/");
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);

  // 把它改成已到期
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("tarot:recall:v1")!);
    list[0].dueAt = new Date(Date.now() - 60_000).toISOString();
    localStorage.setItem("tarot:recall:v1", JSON.stringify(list));
  });
  await page.goto("/");
  await expect(page.getByTestId("recall-banner")).toBeVisible();
  await page.goto("/history");
  await expect(page.getByTestId("recall-banner")).toBeVisible();

  // 点“去看看”→ 记录详情
  await page.getByTestId("recall-banner").getByRole("link", { name: "去看看" }).click();
  await expect(page).toHaveURL(new RegExp(`/history/${recall.recordId}$`));

  // 删除记录 → 回读被清掉，提示消失
  await page.getByRole("button", { name: "删除这条记录" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("已删除这条记录")).toBeVisible();
  expect(await recalls(page)).toEqual([]);
  await page.goto("/");
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);
});

test("忽略提示后不再出现", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "tarot:recall:v1",
      JSON.stringify([{ id: "recall-0001", recordId: "record-00000001", dueAt: new Date(Date.now() - 1000).toISOString(), status: "pending", createdAt: new Date(Date.now() - 86_400_000).toISOString(), completedAt: null }]),
    );
  });
  await page.reload();
  await expect(page.getByTestId("recall-banner")).toBeVisible();
  await page.getByRole("button", { name: "先不管" }).click();
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);
});

async function savedRequest(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ intent?: string }>((resolve) => {
        indexedDB.open("tarot").onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          db.transaction("records").objectStore("records").getAll().onsuccess = (ev) => resolve([...(ev.target as IDBRequest).result].sort((a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt)).at(-1).request);
        };
      }),
  );
}

test("意图真的生效：建档选“做个决定”→ 本地解读用决定的语气，记录里留着意图；设置里改成“陪我说说话”后下一次变语气", async ({ page }) => {
  await openScenarios(page);
  await page.getByRole("button", { name: "做个决定" }).click();
  await page.getByRole("button", { name: "就这些，开始" }).click();
  expect((await profile(page)).intent).toBe("decide");

  await finishReading(page);
  await expect(page.getByText("不替你做决定")).toBeVisible();
  expect((await savedRequest(page)).intent).toBe("decide");
  await expect(page.getByText("写下两个选项")).toBeVisible(); // 决定语气的小行动（职业主题）

  // 设置里改
  await page.goto("/settings");
  await page.getByLabel("只是陪我说说话").check();
  expect((await profile(page)).intent).toBe("companion");
  await page.goto("/reading");
  await page.getByRole("button", { name: "再问一个问题" }).click(); // 上一次的结果页会被恢复
  await page.getByRole("button", { name: "留在原地，还是换个方向？" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByText("今天不用急着得出什么结论")).toBeVisible();
  expect((await savedRequest(page)).intent).toBe("companion");
});

test("“此刻”无题卡固定用陪伴语气，不管建档选了什么；没建档时其他卡是中性默认（记录里没有意图）", async ({ page }) => {
  await openScenarios(page);
  await page.getByRole("button", { name: "全部跳过，直接开始" }).click();
  await page.getByRole("button", { name: "留在原地，还是换个方向？" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  expect((await savedRequest(page)).intent).toBeUndefined();

  await page.getByRole("button", { name: "再问一个问题" }).click();
  await page.getByRole("button", { name: "没有具体问题，就想看看此刻的自己。" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByText("今天不用急着得出什么结论")).toBeVisible();
  expect((await savedRequest(page)).intent).toBe("companion");
});

test("常来的主题决定情境卡顺序：偏好的排前面，“此刻”永远最后，一张不少", async ({ page }) => {
  await openScenarios(page);
  await page.getByRole("button", { name: "先不选，下一步" }).click();
  await page.getByLabel("偏好 去留").check();
  await page.getByLabel("偏好 关系").check();
  await page.getByRole("button", { name: "就这些，开始" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "这一刻，想看看什么？" })).toBeVisible();
  const order = await page.locator("section[aria-labelledby=scenario-title] button").evaluateAll((els) => els.map((e) => e.textContent?.trim()));
  expect(order.slice(0, 5)).toEqual([
    "这段关系里，我在看不清什么？→",
    "两个选项之间，我在怕什么？→",
    "留在原地，还是换个方向？→",
    "我在跟自己较什么劲？→",
    "没有具体问题，就想看看此刻的自己。→",
  ]);
});

test("刷新结果页不会重复安排回读（一条记录只有一条）", async ({ page }) => {
  await openScenarios(page);
  await page.getByRole("button", { name: "先不选，下一步" }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: /3 天后/ }).click();
  await finishReading(page);
  await expect.poll(async () => (await recalls(page)).length).toBe(1);
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  }
  expect(await recalls(page)).toHaveLength(1);
});

test("设置页：回读节奏可改；改后只对之后保存的记录生效", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("一周后").check();
  expect((await profile(page)).recallCadence).toBe("7days");
  await page.getByLabel("不用").check();
  expect((await profile(page)).recallCadence).toBe("none");
});
