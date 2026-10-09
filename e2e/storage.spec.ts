// C4：用户选择与存储。行动默认未决定；IndexedDB / localStorage 不可用时有反馈，保存失败可重试且不重复。

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

async function localResult(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "开始" }).click();
  await page.getByRole("button", { name: /^事业/ }).click();
  await page.getByLabel("你的问题").fill("我在这份工作里到底想要什么？");
  await page.getByRole("button", { name: "就问这个" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await page.getByRole("button", { name: "跳过" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByText("两种读法，哪个更像你？")).toBeVisible();
}

test("小行动默认未决定：不勾选、刷新后仍未决定，点击后才记录", async ({ page }) => {
  await localResult(page);
  const accept = page.getByRole("button", { name: /^就做这个/ });
  await expect(accept).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("这只是一个建议，还没决定也没关系。")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");

  await page.reload();
  await expect(page.getByRole("button", { name: /^就做这个/ })).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: /^就做这个/ }).click();
  await expect(page.getByRole("button", { name: "就做这个 ✓" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "就做这个 ✓" })).toBeVisible();
  expect(await countRecords(page)).toBe(1);
});

test("编辑时清空文本等同跳过", async ({ page }) => {
  await localResult(page);
  await page.getByRole("button", { name: "改成我的版本" }).click();
  await page.getByLabel("修改小行动").fill("   ");
  await page.getByRole("button", { name: "就这样" }).click();
  await expect(page.getByRole("button", { name: "已跳过" })).toBeVisible();
});

test("IndexedDB 写入失败：提示未保存，重试成功后只有一条记录", async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { __failPut: boolean }).__failPut = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if ((window as unknown as { __failPut: boolean }).__failPut) throw new DOMException("quota", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await localResult(page);
  await expect(page.getByTestId("save-status")).toHaveText("未保存：浏览器存储不可用");

  // 结果还在，且开始新问题前会被提醒
  await page.getByRole("button", { name: "再问一个问题" }).click();
  await expect(page.getByText("当前这次解读还没有保存成功")).toBeVisible();
  await page.getByRole("button", { name: "先留在这里" }).click();
  await expect(page.getByText("两种读法，哪个更像你？")).toBeVisible();

  await page.evaluate(() => ((window as unknown as { __failPut: boolean }).__failPut = false));
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  expect(await countRecords(page)).toBe(1);

  await page.reload();
  await expect(page.getByText("两种读法，哪个更像你？")).toBeVisible();
  expect(await countRecords(page)).toBe(1);
});

test("localStorage 不可用：流程照常，提示进度无法恢复，完成记录仍写入 IndexedDB", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await localResult(page);
  await expect(page.getByTestId("draft-unsaved")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");
  expect(await countRecords(page)).toBe(1);
});

test("损坏的草稿不会让页面崩溃，回到起点", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("tarot:session:v2", JSON.stringify({ v: 2, state: { stage: "question" } })));
  await page.goto("/reading");
  await expect(page.getByRole("heading", { name: "最近在想哪方面的事？" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "最近在想哪方面的事？" })).toBeVisible();
});

test("旧版草稿：默认勾选的行动不冒充用户的选择", async ({ page }) => {
  await localResult(page);
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里"); // 等写入落定再改写
  // 把当前草稿改写成 v1 形状（无包装、行动 accepted），并同样改写记录
  await page.evaluate(async () => {
    const v2 = JSON.parse(localStorage.getItem("tarot:session:v2")!);
    const state = v2.state;
    state.choice.action = { status: "accepted", text: state.result.action };
    localStorage.removeItem("tarot:session:v2");
    localStorage.setItem("tarot:session:v1", JSON.stringify(state));
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("tarot");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("records", "readwrite");
        const store = tx.objectStore("records");
        const get = store.get(state.recordId);
        get.onsuccess = () => {
          const rec = get.result;
          rec.choice.action = { status: "accepted", text: state.result.action };
          store.put(rec);
        };
        tx.oncomplete = () => resolve();
      };
    });
  });
  await page.reload();
  await expect(page.getByRole("button", { name: /^就做这个/ })).toHaveAttribute("aria-pressed", "false");
});
