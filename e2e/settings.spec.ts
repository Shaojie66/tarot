import { expect, test, type Page } from "@playwright/test";

async function startQuestion(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "开始" }).click();
  await page.getByRole("button", { name: "自己写一个问题" }).click();
  await page.getByRole("button", { name: /^自我/ }).click();
  await page.getByLabel("你的问题").fill("合成问题：设置检查");
  await page.getByRole("button", { name: "就问这个" }).click();
}

async function recordSettings(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ deckId?: string; settings?: { allowReversed: boolean }; schemaVersion: number }[]>((resolve) => {
        indexedDB.open("tarot").onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          db.transaction("records").objectStore("records").getAll().onsuccess = (ev) => resolve((ev.target as IDBRequest).result);
        };
      }),
  );
}

test("设置页：显示 key 状态但不暴露 key；关闭逆位后抽牌不再出现逆位，且只影响之后的抽牌", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("ai-status")).toContainText("没有配置 API key");
  expect(await page.content()).not.toMatch(/sk-[a-z0-9]/i);

  await page.getByLabel("抽牌时可能出现逆位").uncheck();
  await page.reload();
  await expect(page.getByLabel("抽牌时可能出现逆位")).not.toBeChecked();

  // 多抽几次：一次三张，关闭逆位后不应出现任何旋转的牌
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => localStorage.removeItem("tarot:session:v2"));
    await startQuestion(page);
    await page.getByRole("button", { name: "快速抽牌" }).click();
    await expect(page.getByTestId("slot-2")).toBeVisible();
    expect(await page.locator("[data-testid^=slot-] img.rotate-180").count()).toBe(0);
  }

  // 这次的记录快照为“不允许逆位”
  await page.getByRole("button", { name: "跳过" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  const [rec] = await recordSettings(page);
  expect(rec.schemaVersion).toBe(2);
  expect(rec.settings).toEqual({ allowReversed: false });
  expect(rec.deckId).toBe("rws-1909");

  // 之后改回开启：旧记录快照不变
  await page.goto("/settings");
  await page.getByLabel("抽牌时可能出现逆位").check();
  const after = await recordSettings(page);
  expect(after[0].settings).toEqual({ allowReversed: false });
});

test("设置写入失败：提示只在当前页面有效", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.goto("/settings");
  await page.getByLabel("抽牌时可能出现逆位").uncheck();
  await expect(page.getByRole("alert").filter({ hasText: "没有允许保存设置" })).toBeVisible();
  await expect(page.getByLabel("抽牌时可能出现逆位")).not.toBeChecked();
});
