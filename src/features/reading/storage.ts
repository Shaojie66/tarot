// 浏览器本地存储：完成的记录进 IndexedDB（Dexie），进行中的流程快照进 localStorage。
// 两者都只在这台设备的这个站点里，不同步、不上传。

import Dexie, { type EntityTable } from "dexie";
import { DAILY_KEY, clearDaily, mergeDaily, type DailyEntry } from "@/features/daily/daily";
import { readingRecordSchema, type ReadingRecord, type Review } from "./contract";
import { DRAFT_VERSION, migrateLegacyDraft, parseDraft } from "./draft";
import type { FlowState } from "./flow";

class TarotDB extends Dexie {
  records!: EntityTable<ReadingRecord, "id">;
  constructor() {
    super("tarot");
    this.version(1).stores({ records: "id, createdAt" });
  }
}

let db: TarotDB | null = null;
function getDb(): TarotDB {
  db ??= new TarotDB();
  return db;
}

/** 写入或更新同一条记录（按 id），不会产生重复记录。写入前做 schema 校验。 */
export async function saveRecord(record: ReadingRecord): Promise<void> {
  await getDb().records.put(readingRecordSchema.parse(record));
}

/**
 * 占卜流程保存：记录一旦存在，流程之后只会改“当时的选择”（choice）。
 * 其余字段（含用户在历史里补写的 review、旧记录的 schemaVersion / 牌组）一律以已存的为准，
 * 避免流程里过期的内存状态覆盖它们，也避免把 v1 旧记录悄悄升成 v2。
 */
export async function saveFlowRecord(record: ReadingRecord): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.records, async () => {
    const raw = await db.records.get(record.id);
    const existing = raw ? readingRecordSchema.safeParse(raw) : null;
    const next = existing?.success ? { ...existing.data, choice: record.choice } : record;
    await db.records.put(readingRecordSchema.parse(next));
  });
}

export async function getRecord(id: string): Promise<ReadingRecord | undefined> {
  const raw = await getDb().records.get(id);
  const parsed = readingRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function countRecords(): Promise<number> {
  return getDb().records.count();
}

export interface RecordList {
  records: ReadingRecord[];
  /** 读不出来的条目数（损坏 / 来自未来版本）。不显示、不删除，原样保留在存储里。 */
  unreadable: number;
}

/** 新的在前。无法解析的条目不会让列表崩溃。 */
export async function listRecords(): Promise<RecordList> {
  const rows = await getDb().records.orderBy("createdAt").reverse().toArray();
  const records: ReadingRecord[] = [];
  let unreadable = 0;
  for (const row of rows) {
    const parsed = readingRecordSchema.safeParse(row);
    if (parsed.success) records.push(parsed.data);
    else unreadable++;
  }
  return { records, unreadable };
}

/** 写入或清除回看内容（情绪 / 笔记 / 行动复盘）。只改 review 字段。 */
export async function updateReview(id: string, review: Review | null): Promise<ReadingRecord> {
  const db = getDb();
  return db.transaction("rw", db.records, async () => {
    const existing = readingRecordSchema.parse(await db.records.get(id));
    const { review: _old, ...rest } = existing;
    void _old;
    const next = readingRecordSchema.parse(review ? { ...rest, review } : rest);
    await db.records.put(next);
    return next;
  });
}

export async function deleteRecord(id: string): Promise<void> {
  await getDb().records.delete(id);
  // 进行中的草稿若指向这条记录，一并清掉：否则回到抽牌页时保存 effect 会把刚删掉的记录写回来
  if (loadSession()?.state.recordId === id) clearSession();
}

/** 一键清空：已完成记录（含读不出来的条目）、每日一张、进行中的草稿。设置不属于用户内容，不清。 */
export async function clearEverything(): Promise<void> {
  await getDb().records.clear();
  clearDaily();
  clearSession();
}

/**
 * 导入记录 + 每日一张。记录在一个 IndexedDB 事务里写入；每日一张在 localStorage。
 * 两者不在同一个事务里，所以先写每日一张并留快照，记录写入失败就把它恢复，保证“要么都写要么都不写”。
 */
export async function applyImport(records: ReadingRecord[], dailyAdd: DailyEntry[]): Promise<void> {
  let snapshot: string | null = null;
  try {
    snapshot = localStorage.getItem(DAILY_KEY);
  } catch {}
  if (dailyAdd.length > 0) mergeDaily(dailyAdd);
  try {
    await writeImported(records);
  } catch (error) {
    if (dailyAdd.length > 0) {
      try {
        if (snapshot === null) localStorage.removeItem(DAILY_KEY);
        else localStorage.setItem(DAILY_KEY, snapshot);
      } catch {}
    }
    throw error;
  }
}

/** 导入：整批在一个事务里写入，要么全部成功要么一条都不写。 */
export async function writeImported(records: ReadingRecord[]): Promise<void> {
  const db = getDb();
  const validated = records.map((r) => readingRecordSchema.parse(r));
  await db.transaction("rw", db.records, () => db.records.bulkPut(validated));
}

const SESSION_KEY = "tarot:session:v2";
const LEGACY_SESSION_KEY = "tarot:session:v1";

/** 读取并校验草稿。坏草稿 / 旧版本草稿不会抛异常：能迁移的迁移，否则清掉并回到起点。 */
export function loadSession(): { state: FlowState; legacy: boolean } | null {
  try {
    const current = parseDraft(localStorage.getItem(SESSION_KEY));
    if (current) return { state: current, legacy: false };
    if (localStorage.getItem(SESSION_KEY) !== null) localStorage.removeItem(SESSION_KEY);
    const legacy = migrateLegacyDraft(localStorage.getItem(LEGACY_SESSION_KEY));
    localStorage.removeItem(LEGACY_SESSION_KEY);
    return legacy ? { state: legacy, legacy: true } : null;
  } catch {
    return null;
  }
}

// 草稿能否写入：给界面订阅（useSyncExternalStore），失败时提示"刷新后无法恢复"。
let draftWritable = true;
const draftListeners = new Set<() => void>();
export const subscribeDraftHealth = (listener: () => void) => {
  draftListeners.add(listener);
  return () => void draftListeners.delete(listener);
};
export const getDraftWritable = () => draftWritable;

/** 返回是否写入成功。失败（隐私模式 / 配额）时流程照常，但界面应提示刷新后无法恢复。 */
export function storeSession(state: FlowState): boolean {
  let ok = true;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ v: DRAFT_VERSION, state }));
  } catch {
    ok = false;
  }
  if (ok !== draftWritable) {
    draftWritable = ok;
    draftListeners.forEach((listener) => listener());
  }
  return ok;
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {}
}
