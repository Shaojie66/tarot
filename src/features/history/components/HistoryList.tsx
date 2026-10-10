"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCard } from "@/features/cards/cards";
import { TOPIC_LABELS } from "@/features/cards/schema";
import { MAX_BACKUP_BYTES, backupFileName, buildBackup, buildImportPlan, describeImportResult, describeRejection, parseBackup, type ImportPreview } from "@/features/reading/backup";
import type { ReadingRecord } from "@/features/reading/contract";
import { loadDaily } from "@/features/daily/daily";
import { loadProfile } from "@/features/profile/profile";
import { loadAll as loadRecalls } from "@/features/recall/recall";
import { applyImport, clearEverything, listRecords, snapshotForExport, type ClearPart, type RecordList } from "@/features/reading/storage";
import { randomId } from "@/lib/id";
import { ACTION_STATUS_LABEL, FOLLOW_UP_LABEL, formatTime, snippet } from "../labels";

type Panel = null | "export" | "clear";

export function HistoryList() {
  const [data, setData] = useState<RecordList | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [useIncoming, setUseIncoming] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** 选中的备份文件文本：预览过期时用最新数据重新预检 */
  const fileText = useRef<string | null>(null);

  const reload = useCallback(() => {
    listRecords().then(
      (list) => {
        setData(list);
        setLoadError(false);
      },
      () => setLoadError(true),
    );
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  async function download() {
    let snap;
    try {
      snap = await snapshotForExport();
    } catch {
      setPanel(null);
      return setNotice("没能读到一份稳定的最新数据（读取失败，或另一个窗口正在修改），这次没有生成备份。请稍后再试。");
    }
    setData({ records: snap.records, unreadable: snap.unreadable });
    const now = new Date();
    const blob = new Blob([JSON.stringify(buildBackup(snap.records, now, { daily: snap.daily, recalls: snap.recalls, profile: snap.profile }), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName(now, randomId());
    a.click();
    URL.revokeObjectURL(url);
    setPanel(null);
    const partial = snap.unreadable > 0 ? `注意：有 ${snap.unreadable} 条读不出来的条目没有包含在内，这不是完整备份。` : "";
    setNotice(`已导出 ${snap.records.length} 条记录、${snap.daily.length} 条每日一张、${snap.recalls.length} 条回看提醒（读取于 ${formatTime(snap.readAt)}）。${partial}文件里是明文，请自己保管好。`);
  }

  /** 用此刻最新的本机数据生成预览（不沿用页面加载时的快照）。 */
  async function buildPreview(text: string): Promise<{ preview: ImportPreview } | { error: string }> {
    let fresh: RecordList;
    try {
      fresh = await listRecords();
    } catch {
      return { error: "读取不了本机记录，没有导入任何内容。" };
    }
    setData(fresh);
    const recalls = loadRecalls();
    const result = parseBackup(text, new Map(fresh.records.map((r) => [r.id, r])), {
      dailyKeys: new Set(loadDaily().map((d) => d.dayKey)),
      recallRecordIds: new Set(recalls.map((r) => r.recordId)),
      recallIds: new Set(recalls.map((r) => r.id)),
      recallCount: recalls.length,
      profileOnboarded: loadProfile().onboarded,
    });
    return result.ok ? { preview: result.preview } : { error: describeRejection(result.reason) };
  }

  async function onFile(file: File | undefined) {
    setImportError(null);
    setNotice(null);
    setPreview(null);
    fileText.current = null;
    if (!file) return;
    // 先看大小再读内容：超大文件不进内存
    if (file.size > MAX_BACKUP_BYTES) return setImportError(describeRejection({ kind: "too_large", bytes: file.size }));
    const text = await file.text().catch(() => null);
    if (fileInput.current) fileInput.current.value = "";
    if (text === null) return setImportError("读取文件失败，没有导入任何内容。");
    const built = await buildPreview(text);
    if ("error" in built) return setImportError(built.error);
    fileText.current = text;
    setUseIncoming(new Set());
    setPreview(built.preview);
  }

  async function confirmImport() {
    if (!preview) return;
    setImportError(null);
    const result = await applyImport(buildImportPlan(preview, useIncoming));
    if (result.status === "done") {
      const s = result.steps;
      setNotice(`已导入 ${s.records.added} 条记录、${s.daily.added} 条每日一张、${s.recalls.added} 条回看提醒${s.profile.added ? "，并采用了备份里的偏好" : ""}；跳过 ${preview.skip.length} 条相同记录；保留本机版本 ${preview.conflicts.length - [...useIncoming].length} 条。`);
      setPreview(null);
      fileText.current = null;
    } else if (result.status === "stale" && fileText.current) {
      // 本机在预览后变了：不沿用旧的选择，用最新数据重新生成预览
      const built = await buildPreview(fileText.current);
      setUseIncoming(new Set());
      if ("error" in built) {
        setPreview(null);
        setImportError(`${describeImportResult(result)} ${built.error}`);
      } else {
        setPreview(built.preview);
        setImportError(describeImportResult(result));
      }
    } else {
      // 部分写入 / 失败：保留预览供幂等重试，并按实际存储重读列表
      setImportError(describeImportResult(result));
    }
    reload();
  }

  async function confirmClear() {
    try {
      const { failed } = await clearEverything();
      setPanel(null);
      const labels: Record<ClearPart, string> = { daily: "每日一张", draft: "进行中的草稿", recalls: "回看提醒" };
      setNotice(failed.length === 0 ? "已清空全部记录、每日一张、回看提醒和进行中的草稿。" : `记录已清空，但 ${failed.map((f) => labels[f]).join("、")} 没能清掉，可以再点一次清空重试。`);
    } catch {
      setNotice("清空失败：浏览器存储不可用，记录可能没有被清掉。刷新后以实际内容为准。");
    }
    reload();
  }

  if (loadError) {
    return (
      <p role="alert" className="py-10 text-sm leading-relaxed">
        读取不了这个浏览器里的记录（存储可能被禁用，比如隐私模式），现在无法确认里面有什么。这里没有做任何修改；换回普通窗口再试。
      </p>
    );
  }
  if (!data) return <p className="py-10 text-center text-sm text-muted">正在翻开记录…</p>;

  return (
    <div className="space-y-6">
      {notice && (
        <p role="status" className="rounded-lg bg-surface px-4 py-2 text-sm" data-testid="history-notice">
          {notice}
        </p>
      )}

      {data.unreadable > 0 && (
        <p className="text-xs leading-relaxed text-muted" data-testid="unreadable-note">
          有 {data.unreadable} 条记录读不出来（可能损坏，或来自更新版本的应用）。它们没有被删除，也没有显示在下面。
        </p>
      )}

      {data.records.length === 0 ? (
        <div className="space-y-3 py-10 text-center">
          <p className="text-sm text-muted">还没有记录。完成一次占卜后，会自动保存在这里。</p>
          <Link href="/reading" className="inline-block rounded-full bg-accent px-5 py-2 text-bg">
            去抽牌
          </Link>
        </div>
      ) : (
        <ul className="hairline">
          {data.records.map((r) => (
            <li key={r.id} className="border-b border-line">
              <HistoryItem record={r} />
            </li>
          ))}
        </ul>
      )}

      <section aria-label="备份与清理" className="space-y-3 pt-2 text-sm">
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={data.records.length === 0 && loadDaily().length === 0} onClick={() => setPanel(panel === "export" ? null : "export")} className="rounded-full border border-line px-4 py-1.5 disabled:opacity-40">
            导出备份
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} className="rounded-full border border-line px-4 py-1.5">
            导入备份
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" aria-label="选择备份文件" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          <button type="button" disabled={data.records.length === 0 && data.unreadable === 0 && loadDaily().length === 0} onClick={() => setPanel(panel === "clear" ? null : "clear")} className="rounded-full border border-line px-4 py-1.5 text-muted disabled:opacity-40">
            清空全部
          </button>
        </div>

        {panel === "export" && (
          <div className="space-y-2 rounded-lg bg-surface p-3" role="group" aria-label="导出确认">
            <p className="leading-relaxed">
              备份文件包含你的问题、自解、笔记、偏好等<b>明文</b>，可能被浏览器的下载目录或系统云盘同步。不含 API key、设置（逆位 / 牌组）和进行中的草稿。这是给你自己恢复用的，不是用来分享的。
            </p>
            {data.unreadable > 0 && (
              <p className="leading-relaxed text-accent">有 {data.unreadable} 条记录读不出来，不会包含在备份里，所以这不是一份完整备份。</p>
            )}
            <button type="button" onClick={() => void download()} className="rounded-full bg-accent px-4 py-1.5 text-bg">
              {data.unreadable > 0 ? `仅导出能读取的 ${data.records.length} 条记录（不完整）` : `下载 ${data.records.length} 条记录`}
            </button>
          </div>
        )}

        {panel === "clear" && (
          <div className="space-y-2 rounded-lg bg-surface p-3" role="alert">
            <p className="leading-relaxed">
              将删除这个浏览器里的全部 {data.records.length} 条记录、每日一张的记录、回看提醒{data.unreadable > 0 ? `（和 ${data.unreadable} 条读不出来的条目）` : ""}，以及进行中的草稿；你的偏好和设置会保留。删除后无法恢复，建议先导出备份。
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => void confirmClear()} className="rounded-full border border-accent px-4 py-1.5 text-accent">
                确认清空
              </button>
              <button type="button" onClick={() => setPanel(null)} className="rounded-full border border-line px-4 py-1.5">
                先不清空
              </button>
            </div>
          </div>
        )}

        {importError && (
          <p role="alert" className="rounded-lg bg-surface p-3 leading-relaxed" data-testid="import-error">
            {importError}
          </p>
        )}

        {preview && (
          <div className="space-y-3 rounded-lg bg-surface p-3" role="group" aria-label="导入预览" data-testid="import-preview">
            <p className="leading-relaxed">
              预检通过。将新增 <b>{preview.add.length}</b> 条；<b>{preview.skip.length}</b> 条与本机完全相同，会跳过；<b>{preview.conflicts.length}</b> 条与本机同一 ID 但内容不同。每日一张：补上本机没有的 <b>{preview.dailyAdd.length}</b> 天，已有的 {preview.dailySkip} 天不覆盖。回看提醒：补上 <b>{preview.recallsAdd.length}</b> 条{preview.recallsSkip > 0 && `（${preview.recallsSkip} 条已有或找不到对应记录，跳过）`}{preview.recallsIdConflict > 0 && `（${preview.recallsIdConflict} 条与本机提醒编号冲突，不导入）`}。{preview.profileApply && " 备份里有你的偏好（牌想帮你做什么 / 常来的主题 / 回看节奏），这台设备还没建档，会采用它。"}{preview.profileIgnored && " 备份里的偏好不会覆盖这台设备已有的设置。"}
            </p>
            {preview.conflicts.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-xs text-muted">冲突默认保留本机版本，勾选的才会用文件里的版本覆盖：</legend>
                {preview.conflicts.map((c) => (
                  <label key={c.incoming.id} className="flex items-start gap-2 text-xs leading-relaxed">
                    <input
                      type="checkbox"
                      checked={useIncoming.has(c.incoming.id)}
                      onChange={(e) => {
                        const next = new Set(useIncoming);
                        if (e.target.checked) next.add(c.incoming.id);
                        else next.delete(c.incoming.id);
                        setUseIncoming(next);
                      }}
                    />
                    <span>
                      {snippet(c.incoming.request.question)}（本机保存于 {formatTime(c.existing.createdAt)}）改用文件里的版本
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => void confirmImport()} className="rounded-full bg-accent px-4 py-1.5 text-bg">
                确认导入
              </button>
              <button type="button" onClick={() => setPreview(null)} className="rounded-full border border-line px-4 py-1.5">
                取消
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function HistoryItem({ record }: { record: ReadingRecord }) {
  const names = record.request.cards.map((c) => `${getCard(c.cardId).nameZh}${c.reversed ? "（逆）" : ""}`).join(" · ");
  const followUp = record.review?.followUp;
  return (
    <Link href={`/history/${record.id}`} className="block py-5 transition-colors hover:bg-surface/60">
      <p className="flex items-center justify-between text-xs text-muted">
        <span>
          {TOPIC_LABELS[record.request.topic]} · {formatTime(record.createdAt)}
        </span>
        <span>{record.result.source === "ai" ? "AI" : "本地"}</span>
      </p>
      <p className="mt-1 font-serif text-lg leading-relaxed">{snippet(record.request.question, 60)}</p>
      <p className="mt-1 text-xs text-muted">{names}</p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="text-muted">{ACTION_STATUS_LABEL[record.choice.action.status]}</span>
        {followUp && <span className="text-accent">后来：{FOLLOW_UP_LABEL[followUp.status]}</span>}
        {record.review?.moods.map((m) => (
          <span key={m} className="text-muted">
            {m}
          </span>
        ))}
      </p>
    </Link>
  );
}
