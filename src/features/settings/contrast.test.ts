// 主题色的对比度（WCAG 2.x）。颜色值来自 globals.css 的 CSS 变量，改了变量要同步改这里。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("主题色对比度（正文 ≥ 4.5:1，WCAG AA）", () => {
  const bg = token("bg");
  const surface = token("surface");
  const pairs: [string, string, string][] = [
    ["正文 ink / bg", token("ink"), bg],
    ["正文 ink / surface", token("ink"), surface],
    ["次要文字 muted / bg", token("muted"), bg],
    ["次要文字 muted / surface", token("muted"), surface],
    ["强调 accent / bg", token("accent"), bg],
    ["强调 accent / surface", token("accent"), surface],
    ["按钮文字 bg / accent", bg, token("accent")],
  ];
  it.each(pairs)("%s", (_name, fg, back) => {
    expect(ratio(fg, back)).toBeGreaterThanOrEqual(4.5);
  });

  it("分隔线 line 与背景的差别是装饰性的，不承载信息（不要求 3:1，但不能与背景相同）", () => {
    expect(ratio(token("line"), bg)).toBeGreaterThan(1.1);
  });
});
