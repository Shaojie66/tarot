"use client";

import { useState } from "react";
import { formatTime } from "@/features/history/labels";
import { dismissRecall, markDone, scheduleRecall, type Recall } from "./recall";

const CHOICES = [
  { days: 3, label: "3 天后" },
  { days: 7, label: "一周后" },
] as const;

/**
 * 详情页里这条记录的回看提醒：安排 / 调整 / 已回看 / 不再提醒。
 * 每个操作都只在写入成功后才改变显示；失败时保留原状态并说明。
 * “已回看”和“行动做了没有”互不推断。
 */
export function RecordRecallPanel({ recordId, recall, variant = "detail" }: { recordId: string; recall: Recall | null | undefined; variant?: "detail" | "saved" }) {
  const [failed, setFailed] = useState(false);
  if (recall === undefined) return null;

  const run = (ok: boolean) => setFailed(!ok);
  const schedule = (days: number) => run(scheduleRecall(recordId, days) !== null);

  return (
    <div className="space-y-2 text-sm" data-testid="recall-panel">
      <p className="leading-relaxed" data-testid="recall-state">
        {recall === null && "这条记录没有安排回看提醒。"}
        {recall?.status === "pending" && `安排在 ${formatTime(recall.dueAt)} 回看。`}
        {recall?.status === "done" && `已回看（${formatTime(recall.completedAt ?? recall.createdAt)}）。`}
        {recall?.status === "dismissed" && "已设为不再提醒。"}
      </p>
      <div className="flex flex-wrap items-center gap-x-4">
        {recall?.status === "pending" && (
          <>
            {variant === "detail" && (
            <button type="button" onClick={() => run(markDone(recall.id))} className="inline-flex min-h-11 items-center rounded-full border border-line px-4">
              已回看
            </button>
            )}
            <button type="button" onClick={() => run(dismissRecall(recall.id))} className="inline-flex min-h-11 items-center text-muted underline underline-offset-4">
              {variant === "saved" ? "不提醒这条" : "不再提醒"}
            </button>
          </>
        )}
        {CHOICES.map((c) => (
          <button key={c.days} type="button" onClick={() => schedule(c.days)} className="inline-flex min-h-11 items-center text-muted underline underline-offset-4">
            {recall?.status === "pending" ? `改到${c.label}` : `${c.label}提醒我`}
          </button>
        ))}
      </div>
      {failed && (
        <p role="alert" className="text-xs text-muted">
          没能保存，原来的状态没有变。浏览器存储可能不可用，可以再试一次。
        </p>
      )}
    </div>
  );
}
