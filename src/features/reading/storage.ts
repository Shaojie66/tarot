// 浏览器本地存储：完成的记录进 IndexedDB（Dexie），进行中的流程快照进 localStorage。
// 两者都只在这台设备的这个站点里，不同步、不上传。

import Dexie, { type EntityTable } from "dexie";
import { readingRecordSchema, type ReadingRecord } from "./contract";
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

export async function getRecord(id: string): Promise<ReadingRecord | undefined> {
  const raw = await getDb().records.get(id);
  const parsed = readingRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function countRecords(): Promise<number> {
  return getDb().records.count();
}

const SESSION_KEY = "tarot:session:v1";

export function loadSession(): FlowState | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as FlowState) : null;
  } catch {
    return null;
  }
}

export function storeSession(state: FlowState): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用（隐私模式 / 配额）：流程照常，刷新后无法恢复
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}
