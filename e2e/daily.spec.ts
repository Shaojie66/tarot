import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const DAY1 = new Date("2026-10-09T10:00:00Z");
const DAY2 = new Date("2026-10-10T10:00:00Z");

test.use({ timezoneId: "Europe/London" });

test("每日一张：进入页面不自动抽；抽到后刷新是同一张；不调用任何模型接口", async ({ page }) => {
  const api: string[] = [];
  page.on("request", (r) => r.url().includes("/api/") && api.push(r.url()));
  await page.clock.setFixedTime(DAY1);
  await page.goto("/daily");
  await expect(page.getByRole("button", { name: "抽今天的牌" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tarot:daily:v1"))).toBeNull();

  await page.getByRole("button", { name: "抽今天的牌" }).click();
  const card = page.getByTestId("daily-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("daily-day")).toHaveText("2026-10-09");
  const title = await card.getByRole("heading").innerText();
  const text = await card.innerText();

  for (let i = 0; i < 3; i++) {
    await page.reload();
    await expect(page.getByTestId("daily-card")).toBeVisible();
    expect(await page.getByTestId("daily-card").getByRole("heading").innerText()).toBe(title);
  }
  await expect(page.getByTestId("daily-day")).toContainText("今天已经抽过");
  expect(await page.getByTestId("daily-card").innerText()).toContain(text.split("\n")[2]);
  expect(api.filter((u) => !u.endsWith("/api/status"))).toEqual([]);
  // 文案是单张牌的独立文案，不是三张牌模板
  expect(text).not.toMatch(/此刻的处境|卡住你的东西|可以试的下一步/);
});

test("跨午夜：新的一天可以再抽，前一天的记录保留", async ({ page }) => {
  await page.clock.setFixedTime(DAY1);
  await page.goto("/daily");
  await page.getByRole("button", { name: "抽今天的牌" }).click();
  await expect(page.getByTestId("daily-card")).toBeVisible();

  await page.clock.setFixedTime(DAY2);
  await page.reload();
  await expect(page.getByRole("button", { name: "抽今天的牌" })).toBeVisible();
  await page.getByRole("button", { name: "抽今天的牌" }).click();
  await expect(page.getByTestId("daily-day")).toHaveText("2026-10-10");

  const days = await page.evaluate(() => (JSON.parse(localStorage.getItem("tarot:daily:v1")!) as { dayKey: string; timeZone: string }[]).map((e) => `${e.dayKey}@${e.timeZone}`).sort());
  expect(days).toEqual(["2026-10-09@Europe/London", "2026-10-10@Europe/London"]);
});

test.describe("时区决定日键", () => {
  test.use({ timezoneId: "Asia/Tokyo" });
  test("同一时刻在东京已经是第二天", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-09T20:00:00Z")); // 东京 10-10 05:00
    await page.goto("/daily");
    await page.getByRole("button", { name: "抽今天的牌" }).click();
    await expect(page.getByTestId("daily-day")).toHaveText("2026-10-10");
  });
});

test("每日一张进入备份，清空时一并清除，导入后补回", async ({ page }) => {
  await page.clock.setFixedTime(DAY1);
  await page.goto("/daily");
  await page.getByRole("button", { name: "抽今天的牌" }).click();
  await expect(page.getByTestId("daily-card")).toBeVisible();
  const title = await page.getByTestId("daily-card").getByRole("heading").innerText();

  await page.goto("/history");
  // 只有每日一张、没有三张牌记录时也能导出
  await page.getByRole("button", { name: "导出备份" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^下载/ }).click()]);
  const path = (await download.path())!;
  const backup = JSON.parse(readFileSync(path, "utf8"));
  expect(backup.daily).toHaveLength(1);
  expect(backup.daily[0].dayKey).toBe("2026-10-09");

  await page.getByRole("button", { name: "清空全部" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByTestId("history-notice")).toContainText("已清空");
  expect(await page.evaluate(() => localStorage.getItem("tarot:daily:v1"))).toBeNull();

  await page.getByLabel("选择备份文件").setInputFiles(path);
  await expect(page.getByTestId("import-preview")).toContainText("补上本机没有的 1 天");
  await page.getByRole("button", { name: "确认导入" }).click();
  // 等写入完成的提示再离开页面：导入是分步写入，中途跳走就是中断
  await expect(page.getByTestId("history-notice")).toContainText("已导入");
  await page.goto("/daily");
  await expect(page.getByTestId("daily-card").getByRole("heading")).toHaveText(title);
});

test("存储不可用：仍能看到牌，并提示刷新后可能会变", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.goto("/daily");
  await page.getByRole("button", { name: "抽今天的牌" }).click();
  await expect(page.getByTestId("daily-card")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "刷新后可能会变" })).toBeVisible();
});
