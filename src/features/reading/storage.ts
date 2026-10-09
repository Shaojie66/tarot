// 浏览器本地存储：完成的记录进 IndexedDB（Dexie），进行中的流程快照进 localStorage。
// 两者都只在这台设备的这个站点里，不同步、不上传。

import Dexie, { type EntityTable } from "dexie";
import { readingRecordSchema, type ReadingRecord } from "./contract";
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

export async function getRecord(id: string): Promise<ReadingRecord | undefined> {
  const raw = await getDb().records.get(id);
  const parsed = readingRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export async function countRecords(): Promise<number> {
  return getDb().records.count();
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
