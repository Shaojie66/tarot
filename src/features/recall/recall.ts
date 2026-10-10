// 未来回读（Hindsight）：给某次抽牌设一个未来的轻提醒，到点回来看看当时的自己。
// 定位是"回看当时的自己"，不是行动督促——所以只存到期时间，不存"该做什么"。
// 纯本地（localStorage），不写进记录本身（不动 IndexedDB schema）；删除记录时级联清理。

import { z } from "zod";
import { CapacityError } from "@/lib/capacity";
import { randomId } from "@/lib/id";

export type RecallStatus = "pending" | "done" | "dismissed";

export interface Recall {
  id: string;
  recordId: string;
  /** 到期时间（ISO）。到期时进入"待回看"池。 */
  dueAt: string;
  status: RecallStatus;
  createdAt: string;
  completedAt: string | null;
}

export const RECALL_KEY = "tarot:recall:v1";
export const MAX_RECALLS = 200;

export const recallSchema = z.strictObject({
  id: z.string().min(8),
  recordId: z.string().min(8),
  dueAt: z.string(),
  status: z.enum(["pending", "done", "dismissed"]),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

const listSchema = z.array(recallSchema).catch([]);

/** 备份里的日期：必须是可解析的 ISO 时间，统一规范成 UTC，保证字符串排序和“是否到期”的比较有意义。 */
const isoUtc = z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString());

/**
 * 备份里的回读：比读本机存储时严格（本机读取要容忍旧数据，备份文件有问题就该拒绝）。
 * 状态与完成时间必须一致：pending 没有完成时间，done / dismissed 必须有。
 */
export const recallBackupSchema = z
  .strictObject({
    id: z.string().min(8),
    recordId: z.string().min(8),
    dueAt: isoUtc,
    status: z.enum(["pending", "done", "dismissed"]),
    createdAt: isoUtc,
    completedAt: isoUtc.nullable(),
  })
  .refine((r) => (r.status === "pending") === (r.completedAt === null), { message: "status 与 completedAt 不一致" });


/** 按"3 天后 / 一周后"计算到期时间（以调用时的本地时刻为基准）。 */
export function dueAfter(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

/** 为某次记录设置未来回读。返回新条目（写入失败返回 null，如隐私模式/配额）。 */
export function addRecall(recordId: string, days: number): Recall | null {
  // 一条记录只安排一次回读：刷新结果页、重试保存都会再走到这里，不能每次都新增（已处理 / 已忽略的也算安排过）
  const existing = loadAll().find((r) => r.recordId === recordId);
  if (existing) return existing;
  const createdAt = new Date().toISOString();
  const item: Recall = {
    id: randomId(),
    recordId,
    // 基于 createdAt 计算到期，避免两次 new Date() 跨毫秒导致 dueAt 与 createdAt 基准不一致
    dueAt: dueAfter(days, new Date(createdAt)),
    status: "pending",
    createdAt,
    completedAt: null,
  };
  // 满了就不再新增（返回 null 让调用方如实告诉用户“没安排成功”），绝不为了腾位置挤掉已有的提醒
  const all = loadAll();
  if (all.length >= MAX_RECALLS) return null;
  if (!write([item, ...all])) return null;
  return item;
}

/** 某条记录上的回读（一条记录至多一条）。 */
export function recallForRecord(recordId: string): Recall | undefined {
  return loadAll().find((r) => r.recordId === recordId);
}

/**
 * 用户明确的安排 / 重新安排：无则新建；已有（含已回看 / 已忽略）则在同一条上改回 pending 并重算到期时间。
 * 到期从“确认的此刻”起算。失败返回 null，原状态不变。
 */
export function scheduleRecall(recordId: string, days: number, now: Date = new Date()): Recall | null {
  const all = loadAll();
  const current = all.find((r) => r.recordId === recordId);
  if (!current) {
    if (all.length >= MAX_RECALLS) return null;
    const item: Recall = { id: randomId(), recordId, dueAt: dueAfter(days, now), status: "pending", createdAt: now.toISOString(), completedAt: null };
    return write([item, ...all]) ? item : null;
  }
  const next: Recall = { ...current, dueAt: dueAfter(days, now), status: "pending", completedAt: null };
  return write(all.map((r) => (r.id === current.id ? next : r))) ? next : null;
}

export function dismissRecall(id: string): boolean {
  return patch(id, { status: "dismissed", completedAt: new Date().toISOString() });
}

export function markDone(id: string): boolean {
  return patch(id, { status: "done", completedAt: new Date().toISOString() });
}

/** 删除记录时级联清理指向该记录的回读（在现有 deleteRecord/clearEverything 里调用）。 */
export function removeRecallsForRecord(recordId: string): boolean {
  const next = loadAll().filter((r) => r.recordId !== recordId);
  return write(next);
}

/**
 * 导入（备份）：补上本机该记录还没有回读的条目；一条记录只保留一条。返回新增条数。
 * 超出容量或写入失败都抛错，且不写入任何东西——不会为了容纳新内容挤掉已有提醒。
 */
export function mergeRecalls(incoming: Recall[]): { added: number; skipped: number } {
  const existing = loadAll();
  const have = new Set(existing.map((r) => r.recordId));
  const ids = new Set(existing.map((r) => r.id));
  const fresh = incoming.filter((r) => !have.has(r.recordId) && !ids.has(r.id));
  if (existing.length + fresh.length > MAX_RECALLS) throw new CapacityError("recall");
  if (fresh.length > 0 && !write([...fresh, ...existing])) throw new Error("recall storage unavailable");
  return { added: fresh.length, skipped: incoming.length - fresh.length };
}

export function clearAllRecalls(): boolean {
  return write([]);
}

/** 到期且未处理、未忽略的回读（用于首页/历史提示），最早到期的在前。 */
export function expiredRecalls(now: Date = new Date()): Recall[] {
  const t = now.getTime();
  return loadAll()
    .filter((r) => r.status === "pending" && Date.parse(r.dueAt) <= t)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

/** 最近一条还没到期的 pending 回读的到期时间（用来在页面停留期间跨过到期点时自动刷新）。 */
export function nextDueAt(now: Date = new Date()): number | null {
  const t = now.getTime();
  const upcoming = loadAll()
    .filter((r) => r.status === "pending" && Date.parse(r.dueAt) > t)
    .map((r) => Date.parse(r.dueAt));
  return upcoming.length ? Math.min(...upcoming) : null;
}

export function loadAll(): Recall[] {
  try {
    const raw = localStorage.getItem(RECALL_KEY);
    if (!raw) return [];
    return listSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

function patch(id: string, next: Partial<Recall>): boolean {
  const list = loadAll().map((r) => (r.id === id ? { ...r, ...next } : r));
  return write(list);
}

function write(list: Recall[]): boolean {
  try {
    localStorage.setItem(RECALL_KEY, JSON.stringify(list));
    emit();
    return true;
  } catch {
    return false;
  }
}

// 简易订阅，供到期提示在写入后刷新（与 settings/profile 的 useSyncExternalStore 各自独立）。
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
/**
 * 订阅回读状态变化：本页写入、另一个标签页写入（storage 事件）、页面回到前台、跨过下一个到期时间点。
 * 取消订阅会清掉全部监听与定时器。
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const hasWindow = typeof window !== "undefined";
  const onVisible = () => {
    if (document.visibilityState === "visible") listener();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === RECALL_KEY) {
      listener();
      arm();
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    const next = nextDueAt();
    // setTimeout 上限约 24.8 天；更远的等回到前台 / 写入时再算
    if (next !== null) {
      timer = setTimeout(() => {
        listener();
        arm();
      }, Math.min(next - Date.now() + 50, 2 ** 31 - 1));
    }
  };
  if (hasWindow) {
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    arm();
  }
  const rearm = () => hasWindow && arm();
  listeners.add(rearm);
  return () => {
    listeners.delete(listener);
    listeners.delete(rearm);
    if (hasWindow) {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    }
    clearTimeout(timer);
  };
}
