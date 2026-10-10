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

/** 到期且未处理、未忽略的回读（用于首页/历史提示）。 */
export function expiredRecalls(now: Date = new Date()): Recall[] {
  return loadAll().filter((r) => r.status === "pending" && r.dueAt <= now.toISOString());
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
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
