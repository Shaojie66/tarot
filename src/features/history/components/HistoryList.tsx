"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCard } from "@/features/cards/cards";
import { TOPIC_LABELS } from "@/features/cards/schema";
import { backupFileName, buildBackup, describeRejection, parseBackup, recordsToWrite, type ImportPreview } from "@/features/reading/backup";
import type { ReadingRecord } from "@/features/reading/contract";
import { loadDaily } from "@/features/daily/daily";
import { applyImport, clearEverything, listRecords, type RecordList } from "@/features/reading/storage";
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

  function download() {
    if (!data) return;
    const now = new Date();
    const blob = new Blob([JSON.stringify(buildBackup(data.records, now, loadDaily()), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName(now, randomId());
    a.click();
    URL.revokeObjectURL(url);
    setPanel(null);
    setNotice(`已导出 ${data.records.length} 条记录。文件里是明文，请自己保管好。`);
  }

  async function onFile(file: File | undefined) {
    setImportError(null);
    setNotice(null);
    setPreview(null);
    if (!file || !data) return;
    const text = await file.text().catch(() => null);
    if (text === null) return setImportError("读取文件失败，没有导入任何内容。");
    const result = parseBackup(text, new Map(data.records.map((r) => [r.id, r])), new Set(loadDaily().map((d) => d.dayKey)));
    if (!result.ok) return setImportError(describeRejection(result.reason));
    setUseIncoming(new Set());
    setPreview(result.preview);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function confirmImport() {
    if (!preview) return;
    const toWrite = recordsToWrite(preview, useIncoming);
    try {
      await applyImport(toWrite, preview.dailyAdd);
      setNotice(`已导入 ${toWrite.length} 条记录和 ${preview.dailyAdd.length} 条每日一张；跳过 ${preview.skip.length} 条相同记录；保留本机版本 ${preview.conflicts.length - [...useIncoming].length} 条。`);
      setPreview(null);
      reload();
    } catch {
      setImportError("写入失败，这次没有写入任何内容（整批已回滚）。浏览器存储可能不可用或已满。");
    }
  }

  async function confirmClear() {
    try {
      await clearEverything();
      setPanel(null);
      setNotice("已清空全部记录和进行中的草稿。");
      reload();
    } catch {
      setNotice("清空失败：浏览器存储不可用。");
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="py-10 text-sm leading-relaxed">
        读取不了这个浏览器里的记录（存储可能被禁用，比如隐私模式）。记录没有丢，换回普通窗口就能看到。
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
        <ul className="space-y-3">
          {data.records.map((r) => (
            <li key={r.id}>
              <HistoryItem record={r} />
            </li>
          ))}
        </ul>
      )}

      <section aria-label="备份与清理" className="space-y-3 border-t border-line pt-5 text-sm">
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
              备份文件包含你的问题、自解、笔记等<b>明文</b>，可能被浏览器的下载目录或系统云盘同步。不含 API key 和进行中的草稿。这是给你自己恢复用的，不是用来分享的。
            </p>
            <button type="button" onClick={download} className="rounded-full bg-accent px-4 py-1.5 text-bg">
              下载 {data.records.length} 条记录
            </button>
          </div>
        )}

        {panel === "clear" && (
          <div className="space-y-2 rounded-lg bg-surface p-3" role="alert">
            <p className="leading-relaxed">
              将删除这个浏览器里的全部 {data.records.length} 条记录、每日一张的记录{data.unreadable > 0 ? `（和 ${data.unreadable} 条读不出来的条目）` : ""}，以及进行中的草稿。删除后无法恢复，建议先导出备份。
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
              预检通过。将新增 <b>{preview.add.length}</b> 条；<b>{preview.skip.length}</b> 条与本机完全相同，会跳过；<b>{preview.conflicts.length}</b> 条与本机同一 ID 但内容不同。每日一张：补上本机没有的 <b>{preview.dailyAdd.length}</b> 天，已有的 {preview.dailySkip} 天不覆盖。
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
    <Link href={`/history/${record.id}`} className="block rounded-lg border border-line bg-surface p-4 hover:border-accent">
      <p className="flex items-center justify-between text-xs text-muted">
        <span>
          {TOPIC_LABELS[record.request.topic]} · {formatTime(record.createdAt)}
        </span>
        <span>{record.result.source === "ai" ? "AI" : "本地"}</span>
      </p>
      <p className="mt-1 leading-relaxed">{snippet(record.request.question, 60)}</p>
      <p className="mt-1 text-xs text-muted">{names}</p>
      <p className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-line px-2 py-0.5">{ACTION_STATUS_LABEL[record.choice.action.status]}</span>
        {followUp && <span className="rounded-full border border-accent/60 px-2 py-0.5 text-accent">后来：{FOLLOW_UP_LABEL[followUp.status]}</span>}
        {record.review?.moods.map((m) => (
          <span key={m} className="rounded-full bg-bg px-2 py-0.5 text-muted">
            {m}
          </span>
        ))}
      </p>
    </Link>
  );
}
