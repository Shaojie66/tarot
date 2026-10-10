import { readFileSync } from "node:fs";
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

  // 点“去回看”→ 记录详情的回看区（只打开，不改变状态）
  await page.getByTestId("recall-banner").getByRole("link", { name: "去回看" }).click();
  await expect(page).toHaveURL(new RegExp(`/history/${recall.recordId}#review$`));
  await expect(page.getByRole("heading", { name: "回看", exact: true })).toBeFocused();
  expect((await recalls(page))[0].status).toBe("pending");

  // 删除记录 → 回读被清掉，提示消失
  await page.getByRole("button", { name: "删除这条记录" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("已删除这条记录")).toBeVisible();
  expect(await recalls(page)).toEqual([]);
  await page.goto("/");
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);
});

async function latestRecordId(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        indexedDB.open("tarot").onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          db.transaction("records").objectStore("records").getAll().onsuccess = (ev) => resolve((ev.target as IDBRequest).result.at(-1).id);
        };
      }),
  );
}

/** 走完一次占卜，并把它的回读改成“已到期”（没有默认节奏时直接写一条）。 */
async function readingWithDueRecall(page: Page) {
  await openScenarios(page);
  await page.getByRole("button", { name: "全部跳过，直接开始" }).click();
  await finishReading(page);
  const recordId = await latestRecordId(page);
  await page.evaluate((id) => {
    localStorage.setItem(
      "tarot:recall:v1",
      JSON.stringify([{ id: "recall-0001", recordId: id, dueAt: new Date(Date.now() - 1000).toISOString(), status: "pending", createdAt: new Date(Date.now() - 86_400_000).toISOString(), completedAt: null }]),
    );
  }, recordId);
  await page.goto("/");
  await expect(page.getByTestId("recall-banner")).toBeVisible();
  return recordId;
}

test("到期提示“不再提醒”：永久结束，刷新后不再出现", async ({ page }) => {
  await readingWithDueRecall(page);
  await page.getByTestId("recall-banner").getByRole("button", { name: "不再提醒" }).click();
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);
  expect((await recalls(page))[0].status).toBe("dismissed");
  await page.reload();
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);
});

test("去回看 → 已回看：不要求写字，结束提醒，不改变“后来做了吗”", async ({ page }) => {
  await readingWithDueRecall(page);
  await page.getByTestId("recall-banner").getByRole("link", { name: "去回看" }).click();
  await expect(page.getByTestId("recall-state")).toContainText("安排在");
  await page.getByRole("button", { name: "已回看", exact: true }).click();
  await expect(page.getByTestId("recall-state")).toContainText("已回看");
  expect((await recalls(page))[0].status).toBe("done");
  await expect(page.getByTestId("follow-up-view")).toHaveText("还没有记录");
  await page.goto("/");
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);
});

test("保存回看并完成：先存笔记再结束提醒；之后可以重新安排", async ({ page }) => {
  await readingWithDueRecall(page);
  await page.getByTestId("recall-banner").getByRole("link", { name: "去回看" }).click();
  await page.getByLabel("回看笔记").fill("合成笔记：回头看，没那么急了");
  await page.getByRole("button", { name: "保存回看并完成" }).click();
  await expect(page.getByTestId("review-status")).toContainText("这条提醒已结束");
  expect((await recalls(page))[0].status).toBe("done");
  await page.reload();
  await expect(page.getByLabel("回看笔记")).toHaveValue("合成笔记：回头看，没那么急了");
  await page.getByRole("button", { name: "3 天后提醒我" }).click();
  await expect(page.getByTestId("recall-state")).toContainText("安排在");
  const [r] = await recalls(page);
  expect(r.status).toBe("pending");
  expect(await recalls(page)).toHaveLength(1); // 同一条，不新增
});

test("指向已不存在记录的提醒不会留下提示", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "tarot:recall:v1",
      JSON.stringify([{ id: "recall-0001", recordId: "record-00000001", dueAt: new Date(Date.now() - 1000).toISOString(), status: "pending", createdAt: new Date(Date.now() - 86_400_000).toISOString(), completedAt: null }]),
    );
  });
  await page.reload();
  await expect.poll(async () => (await recalls(page)).length).toBe(0);
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);
});

test("另一个标签页处理了提醒，这一页的提示跟着消失", async ({ page, context }) => {
  await readingWithDueRecall(page);
  const other = await context.newPage();
  await other.goto("/");
  await other.getByTestId("recall-banner").getByRole("button", { name: "不再提醒" }).click();
  await expect(page.getByTestId("recall-banner")).toHaveCount(0);
});

test("保存后显示实际安排的回看时间，可以只对这一条取消；默认节奏不变", async ({ page }) => {
  await openScenarios(page);
  await page.getByRole("button", { name: "先不选，下一步" }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: /3 天后/ }).click();
  await finishReading(page);
  await expect(page.getByTestId("saved-recall")).toContainText("安排在");
  await page.getByRole("button", { name: "不提醒这条" }).click();
  await expect(page.getByTestId("recall-state")).toContainText("不再提醒");
  expect((await recalls(page))[0].status).toBe("dismissed");
  expect((await profile(page)).recallCadence).toBe("3days");
  await page.reload();
  expect(await recalls(page)).toHaveLength(1); // 刷新恢复结果也不会再新增或复活
  expect((await recalls(page))[0].status).toBe("dismissed");
});

test("保存后把默认节奏改成一周，恢复出来的旧结果不会被补发提醒", async ({ page }) => {
  await openScenarios(page);
  await page.getByRole("button", { name: "全部跳过，直接开始" }).click();
  await finishReading(page);
  expect(await recalls(page)).toEqual([]);
  await page.evaluate(() => localStorage.setItem("tarot:profile:v1", JSON.stringify({ onboarded: true, intent: null, topics: [], recallCadence: "7days" })));
  await page.goto("/reading");
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  expect(await recalls(page)).toEqual([]);
});

test("抽牌前可以“仅本次”调整想要的帮助：本次记录用它，下一次回到偏好", async ({ page }) => {
  await openScenarios(page);
  await page.getByRole("button", { name: "做个决定" }).click();
  await page.getByRole("button", { name: "就这些，开始" }).click();
  await page.getByRole("button", { name: "留在原地，还是换个方向？" }).click();
  await expect(page.getByLabel(/这次想要的帮助/)).toHaveValue("decide");
  await page.getByLabel(/这次想要的帮助/).selectOption("companion");
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  expect((await savedRequest(page)).intent).toBe("companion");
  expect((await profile(page)).intent).toBe("decide"); // 偏好没变

  // 下一次：回到偏好（做个决定）
  await page.getByRole("button", { name: "再问一个问题" }).click();
  await page.getByRole("button", { name: "留在原地，还是换个方向？" }).click();
  await expect(page.getByLabel(/这次想要的帮助/)).toHaveValue("decide");
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

test("备份带上回读和建档：新设备导入后采用偏好并补回提醒；已建档的设备不被覆盖", async ({ page, browser }, testInfo) => {
  // 设备 A：建档（决定 / 事业 / 3 天后）→ 走完一次 → 导出
  await openScenarios(page);
  await page.getByRole("button", { name: "做个决定" }).click();
  await page.getByLabel("偏好 事业").check();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: /3 天后/ }).click();
  await finishReading(page);
  await expect.poll(async () => (await recalls(page)).length).toBe(1);
  await page.goto("/history");
  await page.getByRole("button", { name: "导出备份" }).click();
  await expect(page.getByText("偏好等")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^下载/ }).click()]);
  const path = (await download.path())!;
  const backup = JSON.parse(readFileSync(path, "utf8"));
  expect(backup.recalls).toHaveLength(1);
  expect(backup.profile).toEqual({ onboarded: true, intent: "decide", topics: ["career"], recallCadence: "3days" });
  expect(JSON.stringify(backup)).not.toMatch(/api[_-]?key|sk-[a-z0-9]/i); // 没有 key；顶层也没有 settings（见下面的键列表）
  expect(Object.keys(backup).sort()).toEqual(["backupVersion", "contentVersion", "daily", "exportedAt", "format", "profile", "recalls", "records"]);

  const baseURL = testInfo.project.use.baseURL!;

  // 设备 B：全新（没建档）→ 导入 → 采用偏好，补回提醒
  const fresh = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const b = await fresh.newPage();
  await b.goto("/history");
  await b.getByLabel("选择备份文件").setInputFiles(path);
  await expect(b.getByTestId("import-preview")).toContainText("这台设备还没建档，会采用它");
  await expect(b.getByTestId("import-preview")).toContainText("回看提醒：补上 1 条");
  await b.getByRole("button", { name: "确认导入" }).click();
  await expect(b.getByTestId("history-notice")).toContainText("1 条回看提醒");
  expect(await profile(b)).toEqual({ onboarded: true, intent: "decide", topics: ["career"], recallCadence: "3days" });
  expect(await recalls(b)).toHaveLength(1);
  await b.goto("/reading");
  await expect(b.getByRole("heading", { name: "先花几秒定个方向" })).toHaveCount(0); // 已经有偏好，不再问
  // 偏好生效：事业排第一
  const first = await b.locator("section[aria-labelledby=scenario-title] button").first().innerText();
  expect(first).toContain("留在原地，还是换个方向？");
  await fresh.close();

  // 设备 C：已建档（理清）→ 导入 → 偏好不被覆盖，提醒照补
  const used = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const c = await used.newPage();
  await c.goto("/");
  await c.evaluate(() => localStorage.setItem("tarot:profile:v1", JSON.stringify({ onboarded: true, intent: "clarify", topics: [], recallCadence: "none" })));
  await c.goto("/history");
  await c.getByLabel("选择备份文件").setInputFiles(path);
  await expect(c.getByTestId("import-preview")).toContainText("不会覆盖这台设备已有的设置");
  await c.getByRole("button", { name: "确认导入" }).click();
  await expect(c.getByTestId("history-notice")).toBeVisible();
  expect(await profile(c)).toEqual({ onboarded: true, intent: "clarify", topics: [], recallCadence: "none" });
  expect(await recalls(c)).toHaveLength(1);
  await used.close();
});

test("旧备份（没有 recalls / profile 字段）照常能导入", async ({ page }) => {
  await openScenarios(page);
  await page.getByRole("button", { name: "全部跳过，直接开始" }).click();
  await finishReading(page);
  await page.goto("/history");
  await page.getByRole("button", { name: "导出备份" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^下载/ }).click()]);
  const old = JSON.parse(readFileSync((await download.path())!, "utf8"));
  delete old.recalls;
  delete old.profile;
  delete old.daily;
  await page.getByLabel("选择备份文件").setInputFiles({ name: "old.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) });
  await expect(page.getByTestId("import-preview")).toContainText("将新增 0 条");
  await expect(page.getByTestId("import-error")).toHaveCount(0);
});
