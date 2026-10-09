// 每日一张。规则（docs/PLAN.md M3 行为约定 3）：
// - 日键 = 设备当地日期 YYYY-MM-DD；同一天只抽一次，刷新 / 重进返回原牌，不重抽。
// - 跨午夜按新日键创建新牌；记录里留下当时的时区。
// - 抽牌只在客户端 crypto 完成，与三张牌共用 drawCards。
// - 存储：localStorage（不新增 IndexedDB 表，避免未经确认的数据库 schema 变更），见 docs/decisions/003。

import { z } from "zod";
import { DECKS, DEFAULT_DECK, type DeckId } from "@/features/cards/deck";
import { isCardId, type CardId } from "@/features/cards/ids";
import { drawCards } from "@/features/draw/draw";

export const DAILY_KEY = "tarot:daily:v1";
/** 只保留最近这么多天，防止无限增长（约一年）。 */
export const DAILY_MAX_ENTRIES = 400;

const cardId = z.string().refine(isCardId, "unknown card id") as unknown as z.ZodType<CardId>;

export const dailyEntrySchema = z.strictObject({
  /** 当地日期 YYYY-MM-DD */
  dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 抽牌当时的 IANA 时区，例如 Europe/London */
  timeZone: z.string().min(1).max(64),
  drawnAt: z.iso.datetime(),
  cardId,
  reversed: z.boolean(),
  deckId: z.string().refine((id) => id in DECKS, "unknown deck"),
  settings: z.strictObject({ allowReversed: z.boolean() }),
});

export type DailyEntry = Omit<z.infer<typeof dailyEntrySchema>, "deckId"> & { deckId: DeckId };

/** 设备当前时区；取不到时退回 UTC（日键仍然稳定）。 */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** 指定时区下的当地日期。夏令时切换、午夜边界都由 Intl 处理。 */
export function dayKey(now: Date, timeZone: string = deviceTimeZone()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function parseDaily(raw: string | null): DailyEntry[] {
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  const out: DailyEntry[] = [];
  for (const item of json) {
    const parsed = dailyEntrySchema.safeParse(item);
    // 坏条目跳过，其余照常；同一日键只认第一条
    if (!parsed.success || seen.has(parsed.data.dayKey)) continue;
    seen.add(parsed.data.dayKey);
    out.push(parsed.data as DailyEntry);
  }
  return out;
}

export function loadDaily(): DailyEntry[] {
  try {
    return parseDaily(localStorage.getItem(DAILY_KEY));
  } catch {
    return [];
  }
}

function store(entries: DailyEntry[]): boolean {
  const kept = [...entries].sort((a, b) => b.dayKey.localeCompare(a.dayKey)).slice(0, DAILY_MAX_ENTRIES);
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}

export interface DailyOutcome {
  entry: DailyEntry;
  /** 这次是新抽的（false = 今天已经抽过，返回原牌） */
  fresh: boolean;
  /** 新抽的牌没能写入存储：本页内可见，但刷新后会丢 */
  persisted: boolean;
}

/**
 * 取得今天的牌：已有 → 原样返回；没有 → 抽一张并保存。
 * 存储里先读后写，同一天的两次并发调用（两个标签页）以先写入的为准，后到的读到后直接返回。
 */
export function drawDaily(options: { now?: Date; timeZone?: string; allowReversed: boolean; deckId?: DeckId }): DailyOutcome {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? deviceTimeZone();
  const key = dayKey(now, timeZone);
  const existing = loadDaily();
  const found = existing.find((e) => e.dayKey === key);
  if (found) return { entry: found, fresh: false, persisted: true };

  const [drawn] = drawCards({ count: 1, allowReversed: options.allowReversed });
  const entry: DailyEntry = {
    dayKey: key,
    timeZone,
    drawnAt: now.toISOString(),
    cardId: drawn.cardId,
    reversed: drawn.reversed,
    deckId: options.deckId ?? DEFAULT_DECK,
    settings: { allowReversed: options.allowReversed },
  };
  return { entry, fresh: true, persisted: store([entry, ...existing]) };
}

/** 今天已经抽过吗（不抽牌，只查询） */
export function todaysEntry(now: Date = new Date(), timeZone: string = deviceTimeZone()): DailyEntry | undefined {
  const key = dayKey(now, timeZone);
  return loadDaily().find((e) => e.dayKey === key);
}

/** 导入（备份）：只补本机没有的日键，已有的不覆盖。返回新增条数。 */
export function mergeDaily(incoming: DailyEntry[]): { added: number; skipped: number } {
  const existing = loadDaily();
  const have = new Set(existing.map((e) => e.dayKey));
  const fresh = incoming.filter((e) => !have.has(e.dayKey));
  if (fresh.length > 0 && !store([...existing, ...fresh])) throw new Error("daily storage unavailable");
  return { added: fresh.length, skipped: incoming.length - fresh.length };
}

export function clearDaily(): void {
  try {
    localStorage.removeItem(DAILY_KEY);
  } catch {}
}
