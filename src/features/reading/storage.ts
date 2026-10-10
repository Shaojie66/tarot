// 浏览器本地存储：完成的记录进 IndexedDB（Dexie），进行中的流程快照进 localStorage。
// 两者都只在这台设备的这个站点里，不同步、不上传。

import Dexie, { type EntityTable } from "dexie";
import { DAILY_MAX_ENTRIES, clearDaily, loadDaily, mergeDaily } from "@/features/daily/daily";
import { forgetProfileMemory, loadProfile, saveProfile } from "@/features/profile/profile";
import { MAX_RECALLS, clearAllRecalls, loadAll as loadRecalls, mergeRecalls, removeRecallsForRecord } from "@/features/recall/recall";
import { stableStringify, type ImportPlan, type ImportResult, type ImportStepState } from "./backup";
import { MAX_PERSPECTIVES, readingRecordSchema, type Perspective, type ReadingRecord, type Review } from "./contract";
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

/** 追加一份视角快照。同一种语气已经存在就不重复追加（返回已有记录），原解读与用户选择不动。 */
export async function addPerspective(id: string, perspective: Perspective): Promise<ReadingRecord> {
  const db = getDb();
  return db.transaction("rw", db.records, async () => {
    const existing = readingRecordSchema.parse(await db.records.get(id));
    const list = existing.perspectives ?? [];
    if (list.some((p) => p.tone === perspective.tone) || list.length >= MAX_PERSPECTIVES) return existing;
    const next = readingRecordSchema.parse({ ...existing, perspectives: [...list, perspective] });
    await db.records.put(next);
    return next;
  });
}

/** 记录删除成功即 resolve；`recallCleared` = false 表示指向它的回读没清掉（记录已删，提醒仍在）。 */
export async function deleteRecord(id: string): Promise<{ recallCleared: boolean }> {
  await getDb().records.delete(id);
  // 进行中的草稿若指向这条记录，一并清掉：否则回到抽牌页时保存 effect 会把刚删掉的记录写回来
  if (loadSession()?.state.recordId === id) clearSession();
  // 指向这条记录的未来回读一并清掉
  return { recallCleared: removeRecallsForRecord(id) };
}

export type ClearPart = "daily" | "draft" | "recalls";

/**
 * 一键清空：已完成记录（含读不出来的条目）、每日一张、进行中的草稿、回读。建档偏好与设置不属于这一批，不清。
 * 记录清空失败会抛错；其余分项失败不抛，列在 `failed` 里，由调用方如实告诉用户。
 */
export async function clearEverything(): Promise<{ failed: ClearPart[] }> {
  await getDb().records.clear();
  const failed: ClearPart[] = [];
  if (!clearDaily()) failed.push("daily");
  if (!clearSession()) failed.push("draft");
  if (!clearAllRecalls()) failed.push("recalls");
  return { failed };
}

export interface ExportSnapshot extends RecordList {
  daily: ReturnType<typeof loadDaily>;
  recalls: ReturnType<typeof loadRecalls>;
  profile: ReturnType<typeof loadProfile>;
  readAt: string;
}

/**
 * 导出前重新读取全部要进备份的数据（不用页面加载时的快照）。
 * 读取前后各读一次记录，对不上说明另一个标签页正在改，重试几次；仍对不上就抛错，不生成一份混合时点的备份。
 */
export async function snapshotForExport(): Promise<ExportSnapshot> {
  const signature = (l: RecordList) => `${l.unreadable}|${stableStringify(l.records)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await listRecords();
    const daily = loadDaily();
    const recalls = loadRecalls();
    const profile = loadProfile();
    const second = await listRecords();
    if (signature(first) === signature(second)) return { ...second, daily, recalls, profile, readAt: new Date().toISOString() };
  }
  throw new Error("data kept changing during export");
}

/**
 * 导入记录 + 每日一张 + 回读 + 建档。
 *
 * 这不是跨存储事务（IndexedDB 与 localStorage 无法在同一事务里提交），所以只承诺下面这些：
 * 1. 写入前先校验全部记录，并核对“本机现状是否还是预览时的样子”；变了就一条都不写，返回 stale；
 * 2. 记录在一个 IndexedDB 事务里提交，事务内逐条核对，要么全部写入要么一条不写；
 * 3. 记录之后再依次写 每日一张 → 回读 → 建档，每步都回读确认；某步失败不回滚已成功的步骤，
 *    而是如实返回分项结果，重试是幂等的（已存在的不会重复写入）。
 */
export async function applyImport(plan: ImportPlan): Promise<ImportResult> {
  const steps: ImportResult["steps"] = {
    records: { state: "not_attempted", added: 0 },
    daily: { state: "not_attempted", added: 0 },
    recalls: { state: "not_attempted", added: 0 },
    profile: { state: "not_attempted", added: 0 },
  };
  const finish = (status: ImportResult["status"], staleReason?: string): ImportResult => ({ status, staleReason, steps });
  const summarize = (): ImportResult => {
    const states = Object.values(steps);
    if (states.every((s) => s.state === "ok")) return finish("done");
    return finish(states.some((s) => s.state === "ok" && s.added > 0) ? "partial" : "failed");
  };

  // 1. 先校验，任何一条不合格都不写入
  let validated: { incoming: ReadingRecord; expected: ReadingRecord | null }[];
  try {
    validated = plan.records.map((r) => ({ incoming: readingRecordSchema.parse(r.incoming), expected: r.expected }));
  } catch {
    steps.records.state = "failed";
    return finish("failed");
  }

  // 2. localStorage 部分写入前的核对：容量在预览之后被占满，也算“本机变了”
  const dailyHave = new Set(loadDaily().map((d) => d.dayKey));
  const dailyFresh = plan.dailyAdd.filter((d) => !dailyHave.has(d.dayKey));
  if (loadDaily().length + dailyFresh.length > DAILY_MAX_ENTRIES) return finish("stale", "每日一张已满");
  const recallHave = loadRecalls();
  const recallFresh = plan.recallsAdd.filter((r) => !recallHave.some((h) => h.recordId === r.recordId || h.id === r.id));
  if (recallHave.length + recallFresh.length > MAX_RECALLS) return finish("stale", "回看提醒已满");

  // 3. 记录：事务内逐条核对再写。已经等于文件版本的视为已写入（幂等重试）
  try {
    const db = getDb();
    const outcome = await db.transaction("rw", db.records, async () => {
      const toWrite: ReadingRecord[] = [];
      for (const { incoming, expected } of validated) {
        const raw = await db.records.get(incoming.id);
        if (raw === undefined) {
          if (expected !== null) return { stale: "有记录已被删除" };
          toWrite.push(incoming);
          continue;
        }
        const current = readingRecordSchema.safeParse(raw);
        if (!current.success) return { stale: "有记录无法读取" };
        const now = stableStringify(current.data);
        if (now === stableStringify(incoming)) continue;
        if (expected === null || now !== stableStringify(expected)) return { stale: "有记录已被修改" };
        toWrite.push(incoming);
      }
      if (toWrite.length > 0) await db.records.bulkPut(toWrite);
      return { written: toWrite.length };
    });
    if ("stale" in outcome) return finish("stale", outcome.stale);
    steps.records = { state: "ok", added: outcome.written };
  } catch {
    steps.records.state = "failed";
    return finish("failed");
  }

  // 4. 其余分项：各自独立，失败不影响别的步骤，也不撤销已写入的
  steps.daily = writeStep(() => {
    const r = dailyFresh.length > 0 ? mergeDaily(dailyFresh) : { added: 0 };
    const have = new Set(loadDaily().map((d) => d.dayKey));
    return { added: r.added, confirmed: plan.dailyAdd.every((d) => have.has(d.dayKey)) };
  });
  steps.recalls = writeStep(() => {
    const r = recallFresh.length > 0 ? mergeRecalls(recallFresh) : { added: 0 };
    const have = new Set(loadRecalls().map((x) => x.recordId));
    return { added: r.added, confirmed: plan.recallsAdd.every((x) => have.has(x.recordId)) };
  });
  steps.profile = writeStep(() => {
    // 本机已建档（含预览之后才建档）就不覆盖
    if (!plan.profileApply || loadProfile().onboarded) return { added: 0, confirmed: true };
    if (!saveProfile(plan.profileApply)) {
      forgetProfileMemory();
      throw new Error("profile storage unavailable");
    }
    return { added: 1, confirmed: loadProfile().onboarded };
  });
  return summarize();
}

function writeStep(run: () => { added: number; confirmed: boolean }): { state: ImportStepState; added: number } {
  try {
    const { added, confirmed } = run();
    return { state: confirmed ? "ok" : "unconfirmed", added };
  } catch {
    return { state: "failed", added: 0 };
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

export function clearSession(): boolean {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}
