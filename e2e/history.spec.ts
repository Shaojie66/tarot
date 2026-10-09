// M3a：历史、回看、行动复盘、私密备份 / 导入、删除 / 清空。

import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function localReading(page: Page, question: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "开始" }).click();
  await page.getByRole("button", { name: "自己写一个问题" }).click();
  await page.getByRole("button", { name: /^事业/ }).click();
  await page.getByLabel("你的问题").fill(question);
  await page.getByRole("button", { name: "就问这个" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByLabel("你的第一反应").fill("合成自解：有点累");
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
}

test("空历史有引导；完成占卜后出现在历史里，行动状态是“还没决定”", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByText("还没有记录")).toBeVisible();
  await localReading(page, "合成问题：我想要什么样的工作？");
  await page.goto("/history");
  const item = page.getByRole("link", { name: /合成问题：我想要什么样的工作/ });
  await expect(item).toBeVisible();
  await expect(item).toContainText("还没决定");
  await item.click();
  await expect(page.getByTestId("action-decision")).toHaveText("还没决定");
  await expect(page.getByTestId("follow-up-view")).toHaveText("还没有记录");
  await expect(page.locator("figure img")).toHaveCount(3);
});

test("回看：情绪、笔记、行动复盘分别保存，刷新后仍在，且与“当时的决定”分开", async ({ page }) => {
  await localReading(page, "合成问题：要不要换方向？");
  await page.goto("/history");
  await page.getByRole("link", { name: /合成问题：要不要换方向/ }).click();

  await page.getByRole("button", { name: "迷茫", exact: true }).click();
  await page.getByRole("button", { name: "期待", exact: true }).click();
  await page.getByLabel("回看笔记").fill("合成笔记：现在看，我当时更怕的是后悔");
  await page.getByRole("button", { name: "做了一部分" }).click();
  await page.getByLabel("行动复盘说明").fill("写了一半");
  await page.getByRole("button", { name: "保存回看" }).click();
  await expect(page.getByTestId("review-status")).toHaveText("已保存");

  // 当时的决定没有被复盘改动
  await expect(page.getByTestId("action-decision")).toHaveText("还没决定");
  await expect(page.getByTestId("follow-up-view")).toContainText("做了一部分：写了一半");

  await page.reload();
  await expect(page.getByLabel("回看笔记")).toHaveValue("合成笔记：现在看，我当时更怕的是后悔");
  await expect(page.getByRole("button", { name: "迷茫", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/history");
  const item = page.getByRole("link", { name: /合成问题：要不要换方向/ });
  await expect(item).toContainText("后来：做了一部分");
  await expect(item).toContainText("迷茫");
});

test("流程里改选择，不会抹掉历史里补写的笔记", async ({ page }) => {
  await localReading(page, "合成问题：别抹掉我的笔记");
  // 另开一页补写笔记
  const second = await page.context().newPage();
  await second.goto("/history");
  await second.getByRole("link", { name: /别抹掉我的笔记/ }).click();
  await second.getByLabel("回看笔记").fill("合成笔记：不能丢");
  await second.getByRole("button", { name: "保存回看" }).click();
  await expect(second.getByTestId("review-status")).toHaveText("已保存");

  // 原页面（内存里没有笔记）继续改选择
  await page.getByRole("button", { name: /^就做这个/ }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");

  await second.reload();
  await expect(second.getByLabel("回看笔记")).toHaveValue("合成笔记：不能丢");
  await expect(second.getByTestId("action-decision")).toHaveText("决定试试");
});

test("备份导出 → 清空 → 导入，记录无损；备份文件名不含问题文字", async ({ page }) => {
  await localReading(page, "合成问题：备份往返");
  await page.goto("/history");
  await page.getByRole("link", { name: /备份往返/ }).click();
  await page.getByLabel("回看笔记").fill("合成笔记：往返");
  await page.getByRole("button", { name: "保存回看" }).click();
  await expect(page.getByTestId("review-status")).toHaveText("已保存");

  await page.goto("/history");
  await page.getByRole("button", { name: "导出备份" }).click();
  await expect(page.getByText("明文")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^下载 1 条记录/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^tarot-backup-\d{8}-[a-z0-9]{1,6}\.json$/);
  expect(download.suggestedFilename()).not.toContain("备份往返");
  const path = await download.path();
  const backup = JSON.parse(readFileSync(path, "utf8"));
  expect(backup.format).toBe("tarot-backup");
  expect(backup.records[0].review.note).toBe("合成笔记：往返");
  expect(JSON.stringify(backup)).not.toMatch(/ANTHROPIC|DEEPSEEK|api[_-]?key/i);

  // 清空（两步确认）
  await page.getByRole("button", { name: "清空全部" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByText("还没有记录")).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tarot:session")))).toEqual([]);

  // 导入：预览后确认
  await page.getByLabel("选择备份文件").setInputFiles(path);
  await expect(page.getByTestId("import-preview")).toContainText("将新增 1 条");
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByRole("link", { name: /备份往返/ })).toBeVisible();
  await page.getByRole("link", { name: /备份往返/ }).click();
  await expect(page.getByLabel("回看笔记")).toHaveValue("合成笔记：往返");
});

test("导入：重复导入跳过相同记录；坏文件 / 未来版本明确拒绝且不写入", async ({ page }) => {
  await localReading(page, "合成问题：导入检查");
  await page.goto("/history");
  await page.getByRole("button", { name: "导出备份" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^下载/ }).click()]);
  const path = (await download.path())!;
  const good = JSON.parse(readFileSync(path, "utf8"));

  // 相同记录：跳过
  await page.getByLabel("选择备份文件").setInputFiles(path);
  await expect(page.getByTestId("import-preview")).toContainText("将新增 0 条");
  await expect(page.getByTestId("import-preview")).toContainText("1 条与本机完全相同");
  await page.getByRole("button", { name: "取消" }).click();

  const upload = (name: string, body: string) => page.getByLabel("选择备份文件").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(body) });

  await upload("future.json", JSON.stringify({ ...good, backupVersion: 99 }));
  await expect(page.getByTestId("import-error")).toContainText("更新版本");

  await upload("broken.json", "{not json");
  await expect(page.getByTestId("import-error")).toContainText("不是有效的 JSON");

  const bad = structuredClone(good);
  bad.records.push({ ...bad.records[0], id: "合成坏记录-0001", request: { ...bad.records[0].request, cards: [] } });
  await upload("bad.json", JSON.stringify(bad));
  await expect(page.getByTestId("import-error")).toContainText("整个文件都没有导入");

  // 以上拒绝都没有写入任何东西
  await page.reload();
  await expect(page.getByRole("listitem")).toHaveCount(1);
});

test("导入：同 ID 内容不同 → 冲突，默认保留本机，勾选才覆盖", async ({ page }) => {
  await localReading(page, "合成问题：冲突");
  await page.goto("/history");
  await page.getByRole("button", { name: "导出备份" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^下载/ }).click()]);
  const good = JSON.parse(readFileSync((await download.path())!, "utf8"));
  good.records[0].choice = { interpretation: 0, rejected: [], action: { status: "skipped", text: "" } };
  const file = { name: "conflict.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(good)) };

  await page.getByLabel("选择备份文件").setInputFiles(file);
  await expect(page.getByTestId("import-preview")).toContainText("1 条与本机同一 ID 但内容不同");
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByRole("link", { name: /冲突/ }).first().click();
  await expect(page.getByTestId("action-decision")).toHaveText("还没决定"); // 本机保留

  await page.goto("/history");
  await page.getByLabel("选择备份文件").setInputFiles(file);
  await page.getByLabel(/改用文件里的版本/).check();
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByRole("link", { name: /冲突/ }).first().click();
  await expect(page.getByTestId("action-decision")).toHaveText("这次先不做");
});

test("删除单条记录需要确认", async ({ page }) => {
  await localReading(page, "合成问题：删除我");
  await page.goto("/history");
  await page.getByRole("link", { name: /删除我/ }).click();
  await page.getByRole("button", { name: "删除这条记录" }).click();
  await page.getByRole("button", { name: "先留着" }).click();
  await expect(page.getByRole("heading", { name: /删除我/ })).toBeVisible();
  await page.getByRole("button", { name: "删除这条记录" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("已删除这条记录")).toBeVisible();
  await page.goto("/history");
  await expect(page.getByText("还没有记录")).toBeVisible();
});

test("删除记录后回到抽牌页，不会把它写回来", async ({ page }) => {
  await localReading(page, "合成问题：别复活我");
  await page.goto("/history");
  await page.getByRole("link", { name: /别复活我/ }).click();
  await page.getByRole("button", { name: "删除这条记录" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByText("已删除这条记录")).toBeVisible();
  await page.goto("/reading");
  await expect(page.getByRole("heading", { name: "这一刻，想看看什么？" })).toBeVisible();
  await page.goto("/history");
  await expect(page.getByText("还没有记录")).toBeVisible();
});

test("旧版（v1）记录：能显示，标注没有牌组，且不被改写成 v2", async ({ page }) => {
  await localReading(page, "合成问题：旧记录");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tarot");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("records", "readwrite");
          const store = tx.objectStore("records");
          store.getAll().onsuccess = (e) => {
            const [rec] = (e.target as IDBRequest).result;
            delete rec.deckId;
            delete rec.settings;
            rec.schemaVersion = 1;
            store.put(rec);
          };
          tx.oncomplete = () => resolve();
        };
      }),
  );
  await page.goto("/history");
  await page.getByRole("link", { name: /旧记录/ }).click();
  await expect(page.getByTestId("legacy-note")).toBeVisible();
  await page.getByLabel("回看笔记").fill("合成笔记：给旧记录加备注");
  await page.getByRole("button", { name: "保存回看" }).click();
  await expect(page.getByTestId("review-status")).toHaveText("已保存");
  const version = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        indexedDB.open("tarot").onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          db.transaction("records").objectStore("records").getAll().onsuccess = (ev) => resolve((ev.target as IDBRequest).result[0].schemaVersion);
        };
      }),
  );
  expect(version).toBe(1);
});
