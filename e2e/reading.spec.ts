import { expect, test, type Page } from "@playwright/test";

async function countRecords(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("tarot");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("records")) return resolve(0);
          const req = db.transaction("records").objectStore("records").count();
          req.onsuccess = () => resolve(req.result);
        };
      }),
  );
}

async function askQuestion(page: Page, topic: string, question: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "开始" }).click();
  await page.getByRole("button", { name: new RegExp(`^${topic}`) }).click();
  await page.getByLabel("你的问题").fill(question);
  await page.getByRole("button", { name: "就问这个" }).click();
}

test("no API key: full local flow, saved and restored after reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await askQuestion(page, "事业", "我在这份工作里到底想要什么？");
  await page.getByRole("button", { name: "快速抽牌" }).click();
  for (const i of [0, 1, 2]) await expect(page.getByTestId(`slot-${i}`)).toBeVisible();

  // 不填自解
  await page.getByRole("button", { name: "跳过" }).click();
  await expect(page.getByText("没有配置 API key")).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 解读" })).toHaveCount(0);
  await page.getByRole("button", { name: "本地解读" }).click();

  await expect(page.getByText("本地解读", { exact: true })).toBeVisible();
  await expect(page.getByText("两种读法，哪个更像你？")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");

  // 否定一种读法、选另一种、改写小行动
  await page.getByRole("button", { name: "这不符合我的情况" }).first().click();
  await page.getByRole("button", { name: "更像我" }).nth(1).click();
  await page.getByRole("button", { name: "改成我的版本" }).click();
  await page.getByLabel("修改小行动").fill("今晚给自己写一段话");
  await page.getByRole("button", { name: "就这样" }).click();
  await expect(page.getByText("今晚给自己写一段话")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");

  const cardNames = await page.locator("summary").allInnerTexts();
  await page.reload();
  await expect(page.getByText("今晚给自己写一段话")).toBeVisible();
  await expect(page.getByRole("button", { name: "更像我 ✓" })).toBeVisible();
  expect(await page.locator("summary").allInnerTexts()).toEqual(cardNames);
  expect(await countRecords(page)).toBe(1);
  expect(errors).toEqual([]);
});

test("press-and-hold shuffle, then pick cards one by one", async ({ page }) => {
  await askQuestion(page, "去留", "走还是留？");
  const shuffle = page.getByRole("button", { name: "按住洗牌" });
  const box = (await shuffle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1300);
  await page.mouse.up();

  const picks = page.getByRole("button", { name: "抽这张牌" });
  await expect(picks).toHaveCount(7);
  for (const i of [0, 1, 2]) {
    await picks.first().click();
    await expect(page.getByTestId(`slot-${i}`)).toBeVisible();
  }
  await page.getByLabel("你的第一反应").fill("中间那张让我有点不舒服");
  await page.getByRole("button", { name: "继续" }).click();

  // 抽完后刷新：牌不变（不重抽）
  const before = await page.locator("[data-testid^=slot-] p.font-serif").allInnerTexts();
  await page.reload();
  expect(await page.locator("[data-testid^=slot-] p.font-serif").allInnerTexts()).toEqual(before);
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByText("你先看到的是：“中间那张让我有点不舒服”")).toBeVisible();
});

test("keyboard can shuffle", async ({ page }) => {
  await askQuestion(page, "自我", "我在回避什么？");
  await page.getByRole("button", { name: "按住洗牌" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "抽这张牌" })).toHaveCount(7);
});

test("crisis content stops the reading and shows help", async ({ page }) => {
  await askQuestion(page, "自我", "我真的不想活了");
  await expect(page.getByRole("heading", { name: "这一刻，先不抽牌了。" })).toBeVisible();
  await expect(page.getByRole("link", { name: "120" })).toBeVisible();
  await expect(page.getByRole("button", { name: "按住洗牌" })).toHaveCount(0);
});

test("crisis in self-reading is caught before the reading", async ({ page }) => {
  await askQuestion(page, "关系", "我在这段关系里真正需要的是什么？");
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByLabel("你的第一反应").fill("看完只想一了百了");
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByRole("heading", { name: "这一刻，先不抽牌了。" })).toBeVisible();
  expect(await countRecords(page)).toBe(0);
});
