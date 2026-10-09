// 私密完整备份：导出 / 导入预检。纯函数，不碰存储；写入由 storage.writeImported 在单个事务里完成。
// 备份含问题、自解、笔记等私密明文，用于无损恢复；它不是分享格式（分享走白名单，见 docs/PLAN.md「导出边界」）。
// 不含：进行中草稿、API key / 配置、设备信息。

import { dailyEntrySchema, type DailyEntry } from "@/features/daily/daily";
import { profileBackupSchema, type Profile } from "@/features/profile/profile";
import { recallSchema, type Recall } from "@/features/recall/recall";
import { CONTENT_VERSION, readingRecordSchema, type ReadingRecord } from "./contract";

export const BACKUP_FORMAT = "tarot-backup";
/** 备份文件格式版本。更高版本的文件明确拒绝，不猜测、不降级读取。 */
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  backupVersion: number;
  exportedAt: string;
  contentVersion: string;
  records: ReadingRecord[];
  /** 每日一张记录。可选字段：没有它的旧备份照常可导入 */
  daily: DailyEntry[];
  /** 未来回读（指向某条记录的“回来看看当时的自己”）。可选字段 */
  recalls: Recall[];
  /** 首访建档（意图 / 主题偏好 / 回读节奏）。可选字段；导入时只在本机还没建档时采用 */
  profile: Profile | null;
}

export interface BackupExtras {
  daily?: DailyEntry[];
  recalls?: Recall[];
  profile?: Profile | null;
}

export function buildBackup(records: ReadingRecord[], now: Date = new Date(), extras: BackupExtras | DailyEntry[] = {}): Backup {
  // 兼容旧的第三个参数（只传每日一张数组）
  const { daily = [], recalls = [], profile = null } = Array.isArray(extras) ? { daily: extras } : extras;
  const ids = new Set(records.map((r) => r.id));
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    contentVersion: CONTENT_VERSION,
    records: [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    daily: [...daily].sort((a, b) => a.dayKey.localeCompare(b.dayKey)),
    // 回读只带“指向的记录也在这份备份里”的，且每条记录一条
    recalls: recalls.filter((r) => ids.has(r.recordId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    // 没建档就没有可备份的偏好
    profile: profile?.onboarded ? profile : null,
  };
}

/** 文件名只含日期与短 id，不含任何问题文字。 */
export function backupFileName(now: Date, shortId: string): string {
  const d = now.toISOString().slice(0, 10).replaceAll("-", "");
  return `tarot-backup-${d}-${shortId.replace(/[^a-z0-9]/gi, "").slice(0, 6) || "x"}.json`;
}

export type RejectReason =
  | { kind: "too_large"; bytes: number }
  | { kind: "not_json" }
  | { kind: "not_a_backup" }
  | { kind: "future_version"; version: number }
  | { kind: "bad_version" }
  | { kind: "invalid_records"; problems: { index: number; id: string | null; message: string }[]; total: number }
  | { kind: "duplicate_ids"; ids: string[] }
  | { kind: "invalid_daily"; total: number }
  | { kind: "invalid_recalls"; total: number }
  | { kind: "invalid_profile" };

export interface Conflict {
  incoming: ReadingRecord;
  existing: ReadingRecord;
}

export interface ImportPreview {
  /** 本机没有的记录 */
  add: ReadingRecord[];
  /** 本机已有且内容完全相同：跳过 */
  skip: ReadingRecord[];
  /** 同 ID 但内容不同：默认保留本机的，用户逐条选择才改用文件里的 */
  conflicts: Conflict[];
  /** 每日一张：本机没有的日键才会补上，已有的不覆盖 */
  dailyAdd: DailyEntry[];
  dailySkip: number;
  /** 回读：指向的记录存在（本机已有或随本次导入）、且本机该记录还没有回读的才补上 */
  recallsAdd: Recall[];
  recallsSkip: number;
  /** 建档：文件里有，且本机还没建档 → 采用；本机已建档 → 不覆盖（profileIgnored） */
  profileApply: Profile | null;
  profileIgnored: boolean;
}

export interface ImportContext {
  /** 本机已有每日一张的日键 */
  dailyKeys?: ReadonlySet<string>;
  /** 本机已有回读所指向的记录 id */
  recallRecordIds?: ReadonlySet<string>;
  /** 本机是否已经建档 */
  profileOnboarded?: boolean;
}

export type ParseResult = { ok: true; preview: ImportPreview } | { ok: false; reason: RejectReason };

/** 键顺序无关的稳定序列化，用来判断两条记录内容是否完全相同。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const MAX_PROBLEMS_SHOWN = 5;

/**
 * 预检。任何一个问题（坏记录、文件内重复 ID、未来版本）都拒绝整个文件，不做部分导入：
 * 确定性强，用户修好文件或换文件后再来，不会出现“导进去一半”。
 */
export function parseBackup(text: string, existing: ReadonlyMap<string, ReadingRecord>, ctx: ImportContext = {}): ParseResult {
  const existingDailyKeys = ctx.dailyKeys ?? new Set<string>();
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BACKUP_BYTES) return { ok: false, reason: { kind: "too_large", bytes } };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: { kind: "not_json" } };
  }
  if (typeof json !== "object" || json === null) return { ok: false, reason: { kind: "not_a_backup" } };
  const file = json as { format?: unknown; backupVersion?: unknown; records?: unknown; daily?: unknown; recalls?: unknown; profile?: unknown };
  if (file.format !== BACKUP_FORMAT || !Array.isArray(file.records)) return { ok: false, reason: { kind: "not_a_backup" } };
  if (typeof file.backupVersion !== "number" || !Number.isInteger(file.backupVersion) || file.backupVersion < 1) {
    return { ok: false, reason: { kind: "bad_version" } };
  }
  if (file.backupVersion > BACKUP_VERSION) return { ok: false, reason: { kind: "future_version", version: file.backupVersion } };

  const records: ReadingRecord[] = [];
  const problems: { index: number; id: string | null; message: string }[] = [];
  let invalid = 0;
  file.records.forEach((raw: unknown, index: number) => {
    const parsed = readingRecordSchema.safeParse(raw);
    if (parsed.success) return void records.push(parsed.data);
    invalid++;
    if (problems.length < MAX_PROBLEMS_SHOWN) {
      const id = typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : null;
      const issue = parsed.error.issues[0];
      problems.push({ index, id, message: `${issue.path.join(".") || "(根)"}：${issue.message}` });
    }
  });
  if (invalid > 0) return { ok: false, reason: { kind: "invalid_records", problems, total: invalid } };

  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of records) (seen.has(r.id) ? dup : seen).add(r.id);
  if (dup.size > 0) return { ok: false, reason: { kind: "duplicate_ids", ids: [...dup].slice(0, MAX_PROBLEMS_SHOWN) } };

  const daily: DailyEntry[] = [];
  if (file.daily !== undefined) {
    if (!Array.isArray(file.daily)) return { ok: false, reason: { kind: "invalid_daily", total: 1 } };
    const days = new Set<string>();
    let badDaily = 0;
    for (const raw of file.daily) {
      const parsed = dailyEntrySchema.safeParse(raw);
      if (!parsed.success || days.has(parsed.data.dayKey)) badDaily++;
      else {
        days.add(parsed.data.dayKey);
        daily.push(parsed.data as DailyEntry);
      }
    }
    if (badDaily > 0) return { ok: false, reason: { kind: "invalid_daily", total: badDaily } };
  }

  const recalls: Recall[] = [];
  if (file.recalls !== undefined) {
    if (!Array.isArray(file.recalls)) return { ok: false, reason: { kind: "invalid_recalls", total: 1 } };
    const seenRecords = new Set<string>();
    let bad = 0;
    for (const raw of file.recalls) {
      const parsed = recallSchema.safeParse(raw);
      // 同一条记录只能有一条回读；格式不对或重复 → 拒绝整个文件
      if (!parsed.success || seenRecords.has(parsed.data.recordId)) bad++;
      else {
        seenRecords.add(parsed.data.recordId);
        recalls.push(parsed.data);
      }
    }
    if (bad > 0) return { ok: false, reason: { kind: "invalid_recalls", total: bad } };
  }

  let profileFromFile: Profile | null = null;
  if (file.profile !== undefined && file.profile !== null) {
    const parsed = profileBackupSchema.safeParse(file.profile);
    if (!parsed.success) return { ok: false, reason: { kind: "invalid_profile" } };
    profileFromFile = parsed.data;
  }

  const knownRecords = new Set<string>([...existing.keys(), ...records.map((r) => r.id)]);
  const localRecallRecords = ctx.recallRecordIds ?? new Set<string>();
  const recallsAdd = recalls.filter((r) => knownRecords.has(r.recordId) && !localRecallRecords.has(r.recordId));

  const preview: ImportPreview = {
    recallsAdd,
    recallsSkip: recalls.length - recallsAdd.length,
    profileApply: profileFromFile && !ctx.profileOnboarded ? profileFromFile : null,
    profileIgnored: !!profileFromFile && !!ctx.profileOnboarded,
    add: [],
    skip: [],
    conflicts: [],
    dailyAdd: daily.filter((d) => !existingDailyKeys.has(d.dayKey)),
    dailySkip: daily.filter((d) => existingDailyKeys.has(d.dayKey)).length,
  };
  for (const incoming of records) {
    const current = existing.get(incoming.id);
    if (!current) preview.add.push(incoming);
    else if (stableStringify(current) === stableStringify(incoming)) preview.skip.push(incoming);
    else preview.conflicts.push({ incoming, existing: current });
  }
  return { ok: true, preview };
}

/** 预览 + 用户的冲突选择 → 要写入的记录。默认（空选择）只导入新增，保留本机已有。 */
export function recordsToWrite(preview: ImportPreview, useIncoming: ReadonlySet<string> = new Set()): ReadingRecord[] {
  return [...preview.add, ...preview.conflicts.filter((c) => useIncoming.has(c.incoming.id)).map((c) => c.incoming)];
}

export function describeRejection(reason: RejectReason): string {
  switch (reason.kind) {
    case "too_large":
      return `文件太大（${(reason.bytes / 1024 / 1024).toFixed(1)} MB，上限 ${MAX_BACKUP_BYTES / 1024 / 1024} MB），没有导入任何内容。`;
    case "not_json":
      return "这不是有效的 JSON 文件，没有导入任何内容。";
    case "not_a_backup":
      return "这不是本应用导出的备份文件，没有导入任何内容。";
    case "bad_version":
      return "备份文件的版本号无效，没有导入任何内容。";
    case "future_version":
      return `这个备份来自更新版本的应用（备份格式 v${reason.version}，当前只支持 v${BACKUP_VERSION}）。请先升级应用再导入，没有导入任何内容。`;
    case "invalid_records": {
      const first = reason.problems.map((p) => `第 ${p.index + 1} 条${p.id ? `（${p.id}）` : ""}：${p.message}`).join("；");
      return `备份里有 ${reason.total} 条记录无法通过检查，为避免导入一半，整个文件都没有导入。${first}`;
    }
    case "invalid_daily":
      return `备份里有 ${reason.total} 条每日一张记录无法通过检查（格式错误或日期重复），整个文件都没有导入。`;
    case "invalid_recalls":
      return `备份里有 ${reason.total} 条回读提醒无法通过检查（格式错误，或同一条记录有多条），整个文件都没有导入。`;
    case "invalid_profile":
      return "备份里的建档信息无法通过检查，整个文件都没有导入。";
    case "duplicate_ids":
      return `备份文件内有重复的记录 ID（${reason.ids.join("、")}），没有导入任何内容。`;
  }
}
