import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_CARD_IDS } from "@/features/cards/ids";
import { findForbiddenPhrase } from "@/features/reading/guard";
import { DAILY_KEY, DAILY_MAX_ENTRIES, clearDaily, dayKey, drawDaily, loadDaily, mergeDaily, parseDaily, todaysEntry, type DailyEntry } from "./daily";
import { buildDailyReading } from "./daily-reading";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const at = (iso: string) => new Date(iso);

describe("dayKey：当地日期", () => {
  it("同一时刻在不同时区是不同的日子", () => {
    const t = at("2026-10-09T23:30:00Z");
    expect(dayKey(t, "UTC")).toBe("2026-10-09");
    expect(dayKey(t, "Asia/Shanghai")).toBe("2026-10-10");
    expect(dayKey(t, "America/Los_Angeles")).toBe("2026-10-09");
  });

  it("午夜边界：前一秒还是昨天，后一秒是新的一天", () => {
    expect(dayKey(at("2026-10-09T23:59:59Z"), "UTC")).toBe("2026-10-09");
    expect(dayKey(at("2026-10-10T00:00:00Z"), "UTC")).toBe("2026-10-10");
    expect(dayKey(at("2026-10-09T15:59:59Z"), "Asia/Shanghai")).toBe("2026-10-09");
    expect(dayKey(at("2026-10-09T16:00:00Z"), "Asia/Shanghai")).toBe("2026-10-10");
  });

  it("夏令时切换日：伦敦 2026-10-25 凌晨回拨，当天只有一个日键，23:30 仍是 25 号", () => {
    expect(dayKey(at("2026-10-24T23:30:00Z"), "Europe/London")).toBe("2026-10-25"); // 00:30 BST
    expect(dayKey(at("2026-10-25T01:30:00Z"), "Europe/London")).toBe("2026-10-25"); // 第二次 01:30（GMT）
    expect(dayKey(at("2026-10-25T23:30:00Z"), "Europe/London")).toBe("2026-10-25");
    expect(dayKey(at("2026-10-26T00:00:00Z"), "Europe/London")).toBe("2026-10-26");
  });

  it("春季跳时：纽约 2026-03-08 只有 23 小时，日键仍连续", () => {
    expect(dayKey(at("2026-03-08T04:59:00Z"), "America/New_York")).toBe("2026-03-07");
    expect(dayKey(at("2026-03-08T05:00:00Z"), "America/New_York")).toBe("2026-03-08");
    expect(dayKey(at("2026-03-09T03:59:00Z"), "America/New_York")).toBe("2026-03-08");
    expect(dayKey(at("2026-03-09T04:00:00Z"), "America/New_York")).toBe("2026-03-09");
  });
});

describe("drawDaily：同一天只抽一次", () => {
  const opts = { timeZone: "Europe/London", allowReversed: true } as const;

  it("同一天再次进入返回原牌（含刷新）", () => {
    const first = drawDaily({ ...opts, now: at("2026-10-09T08:00:00Z") });
    expect(first.fresh).toBe(true);
    for (const hour of ["09:00", "12:00", "22:59"]) {
      const again = drawDaily({ ...opts, now: at(`2026-10-09T${hour}:00Z`) });
      expect(again.fresh).toBe(false);
      expect(again.entry).toEqual(first.entry);
    }
    expect(loadDaily()).toHaveLength(1);
    expect(todaysEntry(at("2026-10-09T10:00:00Z"), "Europe/London")).toEqual(first.entry);
  });

  it("同一天里把设置改成不允许逆位，也不会重抽", () => {
    const first = drawDaily({ ...opts, now: at("2026-10-09T08:00:00Z") });
    const again = drawDaily({ timeZone: "Europe/London", allowReversed: false, now: at("2026-10-09T09:00:00Z") });
    expect(again.entry).toEqual(first.entry);
  });

  it("跨午夜按新日键新抽；旧的一天保留", () => {
    drawDaily({ ...opts, now: at("2026-10-09T08:00:00Z") });
    const next = drawDaily({ ...opts, now: at("2026-10-10T08:00:00Z") });
    expect(next.fresh).toBe(true);
    expect(next.entry.dayKey).toBe("2026-10-10");
    expect(loadDaily().map((e) => e.dayKey).sort()).toEqual(["2026-10-09", "2026-10-10"]);
  });

  it("记录当时的时区与设置；关闭逆位时不会抽到逆位", () => {
    for (let day = 0; day < 40; day++) {
      drawDaily({ timeZone: "Asia/Tokyo", allowReversed: false, now: new Date(Date.UTC(2026, 10, 1 + day, 3)) });
    }
    const entries = loadDaily();
    expect(entries).toHaveLength(40);
    expect(entries.every((e) => e.timeZone === "Asia/Tokyo" && e.settings.allowReversed === false && e.reversed === false)).toBe(true);
  });

  it("存储写入失败：本页仍有牌，persisted=false，不抛异常", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const r = drawDaily({ ...opts, now: at("2026-10-09T08:00:00Z") });
    expect(r.persisted).toBe(false);
    expect(ALL_CARD_IDS).toContain(r.entry.cardId);
  });

  it("存储读取失败（不可用）：不抛异常", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => drawDaily({ ...opts, now: at("2026-10-09T08:00:00Z") })).not.toThrow();
    expect(loadDaily()).toEqual([]);
  });
});

describe("parseDaily / mergeDaily", () => {
  const entry = (dayKeyValue: string): DailyEntry => ({
    dayKey: dayKeyValue,
    timeZone: "UTC",
    drawnAt: `${dayKeyValue}T08:00:00.000Z`,
    cardId: "the-fool",
    reversed: false,
    deckId: "rws-1909",
    settings: { allowReversed: true },
  });

  it("坏数据 / 坏条目跳过，其余保留；重复日键只认第一条", () => {
    expect(parseDaily("{oops")).toEqual([]);
    expect(parseDaily("{}")).toEqual([]);
    const raw = JSON.stringify([entry("2026-10-01"), { dayKey: "x" }, { ...entry("2026-10-02"), cardId: "nope" }, entry("2026-10-01"), entry("2026-10-03")]);
    expect(parseDaily(raw).map((e) => e.dayKey)).toEqual(["2026-10-01", "2026-10-03"]);
  });

  it("导入只补本机没有的日键，不覆盖已有", () => {
    localStorage.setItem(DAILY_KEY, JSON.stringify([{ ...entry("2026-10-01"), cardId: "death" }]));
    const r = mergeDaily([entry("2026-10-01"), entry("2026-10-02")]);
    expect(r).toEqual({ added: 1, skipped: 1 });
    const all = loadDaily();
    expect(all.find((e) => e.dayKey === "2026-10-01")?.cardId).toBe("death");
    expect(all).toHaveLength(2);
  });

  it("导入超出容量：整批拒绝，本机已有条目逐项不变（不按日期挤掉旧的）", () => {
    const old = Array.from({ length: DAILY_MAX_ENTRIES }, (_, i) => entry(new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10)));
    mergeDaily(old);
    const before = JSON.stringify(loadDaily());
    expect(() => mergeDaily([entry("2030-01-01")])).toThrow(/capacity/);
    expect(JSON.stringify(loadDaily())).toBe(before);
    // 399 + 1 恰好放得下
    localStorage.removeItem(DAILY_KEY);
    mergeDaily(old.slice(1));
    expect(mergeDaily([entry("2030-01-01")]).added).toBe(1);
    expect(loadDaily()).toHaveLength(DAILY_MAX_ENTRIES);
  });

  it("clearDaily", () => {
    mergeDaily([entry("2026-10-01")]);
    clearDaily();
    expect(loadDaily()).toEqual([]);
  });
});

describe("每日文案：独立于三张牌模板，不含断言", () => {
  it("78 张牌 × 正逆位，全部通过文案红线，且不出现三张牌模板用语", () => {
    for (const id of ALL_CARD_IDS) {
      for (const reversed of [false, true]) {
        const r = buildDailyReading(id, reversed);
        const texts = [r.meaning, r.question, r.notice, ...r.keywords];
        expect(findForbiddenPhrase(texts), `${id} ${reversed}`).toBeNull();
        expect(r.question).toMatch(/？$/);
        expect(texts.join("")).not.toMatch(/此刻的处境|卡住你的东西|可以试的下一步/);
      }
    }
  });
});
