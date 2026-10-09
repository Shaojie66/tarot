import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("空 / 损坏 / 非对象 → 默认值，不抛异常", () => {
    for (const raw of [null, "", "{oops", "null", "[]", "123"]) expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });
  it("读取合法值", () => {
    expect(parseSettings(JSON.stringify({ allowReversed: false, deckId: "rws-1909" }))).toEqual({ allowReversed: false, deckId: "rws-1909" });
  });
  it("未知牌组回到默认牌组；类型错误的字段回到各自默认", () => {
    expect(parseSettings(JSON.stringify({ allowReversed: "no", deckId: "deleted-deck" }))).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ allowReversed: false, deckId: 7 })).allowReversed).toBe(false);
  });
});
