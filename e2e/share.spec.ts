import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const SECRET_Q = "合成问题：我该不该离开星河公司";
const SECRET_SELF = "合成自解：想起了外婆";

async function savedReading(page: Page, decide: boolean) {
  await page.goto("/");
  await page.getByRole("link", { name: "开始" }).click();
  await page.getByRole("button", { name: /^事业/ }).click();
  await page.getByLabel("你的问题").fill(SECRET_Q);
  await page.getByRole("button", { name: "就问这个" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByLabel("你的第一反应").fill(SECRET_SELF);
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  if (decide) {
    await page.getByRole("button", { name: /^就做这个/ }).click();
    await expect(page.getByRole("button", { name: "就做这个 ✓" })).toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  }
  await page.goto("/history");
  await page.getByRole("link", { name: new RegExp(SECRET_Q.slice(0, 8)) }).click();
}

function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString()).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("分享图默认只含白名单内容：预览说明里没有问题 / 自解 / 解读正文；生成真实 PNG", async ({ page }) => {
  await savedReading(page, true);
  await expect(page.getByLabel(/我的问题：/)).not.toBeChecked();
  await page.getByRole("button", { name: "生成预览" }).click();
  await expect(page.getByTestId("share-preview")).toBeVisible();

  const contents = await page.getByTestId("share-contents").innerText();
  expect(contents).toContain("此刻三张牌");
  expect(contents).toContain("牌组：莱德-韦特 1909 原版");
  expect(contents).toContain("不预测未来");
  for (const secret of [SECRET_Q, SECRET_SELF, "合成"]) expect(contents).not.toContain(secret);
  expect(contents).not.toMatch(/我的问题|我的小行动|2026|localhost|http/);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "下载图片" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^tarot-share-[0-9a-f]{6}\.png$/);
  const png = readFileSync((await download.path())!);
  const { width, height } = pngSize(png);
  expect(width).toBe(1080);
  expect(height).toBeGreaterThan(900);
  expect(png.length).toBeGreaterThan(20_000);
});

test("勾选问题后必须重新生成预览；预览说明列出新增内容；取消勾选又回到默认", async ({ page }) => {
  await savedReading(page, true);
  await page.getByRole("button", { name: "生成预览" }).click();
  await expect(page.getByTestId("share-preview")).toBeVisible();

  await page.getByLabel(/我的问题：/).check();
  await expect(page.getByTestId("share-preview")).toHaveCount(0); // 旧预览作废
  await page.getByRole("button", { name: "生成预览" }).click();
  const withQuestion = await page.getByTestId("share-contents").innerText();
  expect(withQuestion).toContain(`我的问题：${SECRET_Q}`);
  expect(withQuestion).not.toContain(SECRET_SELF);
  expect(withQuestion).not.toContain("我的小行动");

  await page.getByLabel(/我的问题：/).uncheck();
  await page.getByRole("button", { name: "生成预览" }).click();
  expect(await page.getByTestId("share-contents").innerText()).not.toContain(SECRET_Q);
});

test("还没决定行动：小行动选项不可勾选", async ({ page }) => {
  await savedReading(page, false);
  await expect(page.getByLabel(/我的小行动/)).toBeDisabled();
});
