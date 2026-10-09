// 无障碍回归：键盘全流程、可见焦点、触屏目标尺寸、reduced-motion、读屏语义（名称 / 标题 / 语言）。
// 没有引入 axe 等新依赖，用 Playwright + 页面内的语义检查。

import { expect, test, type Page } from "@playwright/test";

/** 用 Tab 把焦点移到可访问名称匹配的元素上（最多 60 次），证明它可被键盘到达且没有键盘陷阱。 */
async function tabTo(page: Page, name: RegExp | string) {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const current = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return "";
      const label = el.getAttribute("aria-label") || (el as HTMLInputElement).labels?.[0]?.textContent || el.textContent || (el as HTMLInputElement).placeholder || "";
      return label.replace(/\s+/g, " ").trim();
    });
    if (typeof name === "string" ? current === name : name.test(current)) return current;
  }
  throw new Error(`键盘 Tab 60 次没有到达：${name}`);
}

test("只用键盘走完一次本地占卜并保存", async ({ page }) => {
  await page.goto("/");
  await tabTo(page, "开始");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "这一刻，想看看什么？" })).toBeVisible();

  await tabTo(page, "自己写一个问题");
  await page.keyboard.press("Enter");
  await tabTo(page, /^事业/);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("你的问题")).toBeVisible();
  await tabTo(page, "你的问题");
  await page.keyboard.type("合成问题：键盘也能用吗？");
  await tabTo(page, "就问这个");
  await page.keyboard.press("Enter");

  await tabTo(page, "快速抽牌");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("slot-2")).toBeVisible();

  await tabTo(page, "跳过");
  await page.keyboard.press("Enter");
  await tabTo(page, "本地解读");
  await page.keyboard.press("Space");
  await expect(page.getByText("两种读法，哪个更像你？")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("已保存在这台设备的浏览器里");

  // 结果页里的选择也能用键盘操作（Space 触发按钮）
  await tabTo(page, "这次先不做");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "已跳过" })).toBeVisible();
});

test("键盘焦点可见：Tab 到的按钮 / 链接 / 输入框都有 focus-visible 样式", async ({ page }) => {
  for (const path of ["/", "/reading", "/history", "/settings", "/daily"]) {
    await page.goto(path);
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const outlined = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
        const shadow = cs.boxShadow !== "none";
        return { tag: el.tagName, visible: outlined || shadow, text: (el.textContent || "").slice(0, 12) };
      });
      if (info) {
        seen.push(`${info.tag}:${info.text}`);
        expect(info.visible, `${path} 的 ${info.tag}「${info.text}」聚焦时没有可见焦点样式`).toBe(true);
      }
    }
    expect(seen.length, path).toBeGreaterThan(0);
  }
});

test("触屏目标尺寸：主要页面里可点击元素不小于 24×24 CSS px（WCAG 2.5.8 AA），并记录小于 44 的数量", async ({ page }) => {
  const tooSmall: string[] = [];
  const under44: string[] = [];
  for (const path of ["/", "/reading", "/daily", "/history", "/settings", "/cards"]) {
    await page.goto(path);
    const found = await page.evaluate(() => {
      const out: { name: string; w: number; h: number }[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]):not(.sr-only), select, textarea, summary")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // 行内文字链接（段落里的链接）按规范可以豁免；这里只统计独立控件
        if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.closest("p, li")) continue;
        out.push({ name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) });
      }
      return out;
    });
    for (const f of found) {
      if (f.w < 24 || f.h < 24) tooSmall.push(`${path} ${f.name} ${f.w}×${f.h}`);
      else if (f.w < 44 || f.h < 44) under44.push(`${path} ${f.name} ${f.w}×${f.h}`);
    }
  }
  console.log(`[a11y] 小于 44px 的控件 ${under44.length} 个（AAA / 平台建议，非失败项）：${under44.join("；")}`);
  expect(tooSmall, "小于 24×24 的触控目标").toEqual([]);
});

test("reduced-motion：翻牌过渡与洗牌动画被关闭", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/reading");
  await page.getByRole("button", { name: "自己写一个问题" }).click();
  await page.getByRole("button", { name: /^事业/ }).click();
  await page.getByLabel("你的问题").fill("合成问题：动画");
  await page.getByRole("button", { name: "就问这个" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await expect(page.getByTestId("slot-0")).toBeVisible();
  const motion = await page.evaluate(() => {
    const flips = [...document.querySelectorAll<HTMLElement>(".flip-inner")];
    return flips.map((el) => getComputedStyle(el).transitionDuration);
  });
  expect(motion.length).toBeGreaterThan(0);
  for (const d of motion) expect(d).toBe("0s");
});

test("读屏语义：页面语言、唯一主标题、控件 / 图片都有名称、状态用 live region", async ({ page }) => {
  for (const path of ["/", "/reading", "/daily", "/history", "/settings", "/cards", "/cards/the-fool"]) {
    await page.goto(path);
    expect(await page.locator("html").getAttribute("lang"), path).toBe("zh-CN");
    expect(await page.locator("h1").count(), `${path} 应有且仅有一个 h1`).toBe(1);
    const unnamed = await page.evaluate(() => {
      const bad: string[] = [];
      const nameOf = (el: HTMLElement) => {
        const labelled = el.getAttribute("aria-labelledby");
        return (
          el.getAttribute("aria-label") ||
          (labelled && labelled.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ")) ||
          (el as HTMLInputElement).labels?.[0]?.textContent ||
          el.getAttribute("alt") ||
          el.getAttribute("title") ||
          el.textContent ||
          ""
        ).trim();
      };
      for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, img, summary")) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (!nameOf(el)) bad.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}`);
      }
      return bad;
    });
    expect(unnamed, `${path} 里没有可访问名称的元素`).toEqual([]);
  }

  // 抽牌后的牌面图有 alt（含正逆位），状态变化有 live region
  await page.goto("/reading");
  await page.getByRole("button", { name: "自己写一个问题" }).click();
  await page.getByRole("button", { name: /^事业/ }).click();
  await page.getByLabel("你的问题").fill("合成问题：读屏");
  await page.getByRole("button", { name: "就问这个" }).click();
  await page.getByRole("button", { name: "快速抽牌" }).click();
  await expect(page.getByTestId("slot-2")).toBeVisible();
  const alts = await page.locator("main img").evaluateAll((imgs) => imgs.map((i) => i.getAttribute("alt")));
  expect(alts).toHaveLength(3);
  for (const alt of alts) expect(alt && alt.length).toBeGreaterThan(1);
  await page.getByRole("button", { name: "跳过" }).click();
  await page.getByRole("button", { name: "本地解读" }).click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("role", "status");
});
