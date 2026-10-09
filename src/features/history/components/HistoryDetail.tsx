"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CardImage } from "@/components/CardImage";
import { getCard } from "@/features/cards/cards";
import { TOPIC_LABELS } from "@/features/cards/schema";
import {
  FOLLOW_UP_NOTE_MAX,
  FOLLOW_UP_STATUSES,
  MOODS,
  NOTE_MAX,
  recordDeck,
  type ReadingRecord,
  type Review,
} from "@/features/reading/contract";
import { getSpread } from "@/features/reading/spread";
import { PerspectivePanel } from "@/features/perspective/PerspectivePanel";
import { SharePanel } from "@/features/share/SharePanel";
import { deleteRecord, getRecord, updateReview } from "@/features/reading/storage";
import { ACTION_STATUS_LABEL, FOLLOW_UP_LABEL, formatTime } from "../labels";

type Load = { state: "loading" } | { state: "missing" } | { state: "error" } | { state: "ok"; record: ReadingRecord };

export function HistoryDetail({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRecord(id).then(
      (record) => !cancelled && setLoad(record ? { state: "ok", record } : { state: "missing" }),
      () => !cancelled && setLoad({ state: "error" }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (deleted) return <p className="py-10 text-sm">已删除这条记录。<Link href="/history" className="underline underline-offset-4">回到历史</Link></p>;
  if (load.state === "loading") return <p className="py-10 text-center text-sm text-muted">正在翻开这条记录…</p>;
  if (load.state === "error") return <p role="alert" className="py-10 text-sm">读取不了这个浏览器里的记录（存储可能被禁用）。</p>;
  if (load.state === "missing") {
    return (
      <p className="py-10 text-sm leading-relaxed">
        找不到这条记录。它可能已被删除，或保存在另一个浏览器 / 端口里。<Link href="/history" className="underline underline-offset-4">回到历史</Link>
      </p>
    );
  }
  return <Detail record={load.record} onChange={(record) => setLoad({ state: "ok", record })} onDeleted={() => setDeleted(true)} />;
}

function Detail({ record, onChange, onDeleted }: { record: ReadingRecord; onChange: (r: ReadingRecord) => void; onDeleted: () => void }) {
  const spread = getSpread(record.request.spreadId);
  const { deckId, legacy } = recordDeck(record);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const { choice, result } = record;

  return (
    <article className="space-y-8" aria-labelledby="record-title">
      <header className="space-y-2">
        <p className="text-xs text-muted">
          {TOPIC_LABELS[record.request.topic]} · {formatTime(record.createdAt)} · {result.source === "ai" ? "AI 解读" : "本地解读"}
        </p>
        <h2 id="record-title" className="font-serif text-xl leading-snug">
          {record.request.question}
        </h2>
        {record.request.originalQuestion !== record.request.question && (
          <p className="text-sm text-muted">你的原话：{record.request.originalQuestion}</p>
        )}
        {record.request.selfReading && <p className="text-sm">你当时先看到的是：“{record.request.selfReading}”</p>}
        {legacy && (
          <p className="text-xs text-muted" data-testid="legacy-note">
            这是较早版本保存的记录，没有记下当时的牌组，牌面按默认牌组显示。
          </p>
        )}
      </header>

      <section aria-label="抽到的牌" className="grid grid-cols-3 gap-3">
        {record.request.cards.map((c) => (
          <figure key={c.position} className="space-y-1 text-center">
            <CardImage card={getCard(c.cardId)} reversed={c.reversed} deck={deckId} sizes="120px" />
            <figcaption className="text-xs text-muted">
              {spread.positions[c.position].label}
              <br />
              {getCard(c.cardId).nameZh}
              {c.reversed && "（逆位）"}
            </figcaption>
          </figure>
        ))}
      </section>

      <section aria-labelledby="snapshot-title" className="space-y-3">
        <h3 id="snapshot-title" className="font-serif text-lg">
          当时的解读 <span className="text-xs text-muted">（保存时的快照，不会随更新改变）</span>
        </h3>
        <p className="leading-relaxed">{result.overall}</p>
        {result.interpretations.map((text, i) => (
          <div key={i} className={`rounded-lg border p-3 ${choice.interpretation === i ? "border-accent" : "border-line"} ${choice.rejected.includes(i as 0 | 1) ? "opacity-50" : ""}`}>
            <p className="text-xs text-muted">
              读法{i === 0 ? "一" : "二"}
              {choice.interpretation === i && " · 你选了“更像我”"}
              {choice.rejected.includes(i as 0 | 1) && " · 你标记了“不符合我的情况”"}
            </p>
            <p className="mt-1 leading-relaxed">{text}</p>
          </div>
        ))}
        <p className="border-l-2 border-accent pl-3 font-serif leading-relaxed">{result.question}</p>
      </section>

      <section aria-labelledby="action-title" className="space-y-2 rounded-lg bg-surface p-4">
        <h3 id="action-title" className="font-serif text-lg">
          小行动
        </h3>
        <dl className="space-y-2 text-sm leading-relaxed">
          <div>
            <dt className="text-xs text-muted">当时的建议</dt>
            <dd>{result.action}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">你当时的决定</dt>
            <dd data-testid="action-decision">
              {ACTION_STATUS_LABEL[choice.action.status]}
              {choice.action.status === "edited" && `：${choice.action.text}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">后来做了吗</dt>
            <dd data-testid="follow-up-view">
              {record.review?.followUp ? (
                <>
                  {FOLLOW_UP_LABEL[record.review.followUp.status]}
                  {record.review.followUp.note && `：${record.review.followUp.note}`}
                </>
              ) : (
                <span className="text-muted">还没有记录</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <PerspectivePanel record={record} onSaved={onChange} />

      <ReviewEditor record={record} onSaved={onChange} />

      <SharePanel record={record} />

      <section className="border-t border-line pt-5 text-sm">
        {deleteFailed && <p role="alert" className="mb-2">删除失败：浏览器存储不可用。</p>}
        {confirmDelete ? (
          <div role="alert" className="space-y-2 rounded-lg bg-surface p-3">
            <p>删除这条记录后无法恢复（备份里如果有，不受影响）。确定吗？</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => deleteRecord(record.id).then(onDeleted, () => setDeleteFailed(true))}
                className="rounded-full border border-accent px-4 py-1.5 text-accent"
              >
                确认删除
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-full border border-line px-4 py-1.5">
                先留着
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-muted underline underline-offset-4">
            删除这条记录
          </button>
        )}
      </section>
    </article>
  );
}

function ReviewEditor({ record, onSaved }: { record: ReadingRecord; onSaved: (r: ReadingRecord) => void }) {
  const initial = record.review;
  const [moods, setMoods] = useState<Review["moods"]>(initial?.moods ?? []);
  const [note, setNote] = useState(initial?.note ?? "");
  const [status, setStatus] = useState<NonNullable<Review["followUp"]>["status"] | null>(initial?.followUp?.status ?? null);
  const [followNote, setFollowNote] = useState(initial?.followUp?.note ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const dirty =
    stableMoods(moods) !== stableMoods(initial?.moods ?? []) ||
    note !== (initial?.note ?? "") ||
    status !== (initial?.followUp?.status ?? null) ||
    followNote !== (initial?.followUp?.note ?? "");

  function toggleMood(m: (typeof MOODS)[number]) {
    setState("idle");
    setMoods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : cur.length >= 3 ? cur : [...cur, m]));
  }

  async function save() {
    setState("saving");
    const now = new Date().toISOString();
    const empty = moods.length === 0 && !note.trim() && status === null;
    const review: Review | null = empty
      ? null
      : {
          moods,
          note: note.trim(),
          followUp: status ? { status, note: followNote.trim(), at: initial?.followUp?.status === status && initial.followUp.note === followNote.trim() ? initial.followUp.at : now } : null,
          updatedAt: now,
        };
    try {
      onSaved(await updateReview(record.id, review));
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  return (
    <section aria-labelledby="review-title" className="space-y-4">
      <h3 id="review-title" className="font-serif text-lg">
        回看
      </h3>
      <p className="text-xs text-muted">这些是你事后补的，和当时的解读、当时的决定分开存放，随时可以改。</p>

      <fieldset className="space-y-2">
        <legend className="text-sm">现在回头看，当时的心情（最多 3 个）</legend>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={moods.includes(m)}
              onClick={() => toggleMood(m)}
              className={`rounded-full border px-3 py-1 text-sm ${moods.includes(m) ? "border-accent bg-accent text-bg" : "border-line"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="review-note" className="text-sm">
          回看笔记
        </label>
        <textarea
          id="review-note"
          value={note}
          maxLength={NOTE_MAX}
          rows={4}
          onChange={(e) => {
            setNote(e.target.value);
            setState("idle");
          }}
          placeholder="现在回头看，有什么不一样的想法？"
          className="w-full rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm">那个小行动，后来做了吗？</legend>
        <div className="flex flex-wrap gap-2">
          {FOLLOW_UP_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => {
                setStatus(status === s ? null : s);
                setState("idle");
              }}
              className={`rounded-full border px-3 py-1 text-sm ${status === s ? "border-accent bg-accent text-bg" : "border-line"}`}
            >
              {FOLLOW_UP_LABEL[s]}
            </button>
          ))}
        </div>
        {status && (
          <>
            <label htmlFor="follow-note" className="sr-only">
              行动复盘说明
            </label>
            <input
              id="follow-note"
              value={followNote}
              maxLength={FOLLOW_UP_NOTE_MAX}
              onChange={(e) => {
                setFollowNote(e.target.value);
                setState("idle");
              }}
              placeholder="想补一句也可以（可不写）"
              className="w-full rounded-lg border border-line bg-surface p-2 text-sm"
            />
          </>
        )}
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="button" disabled={!dirty || state === "saving"} onClick={() => void save()} className="rounded-full bg-accent px-5 py-1.5 text-bg disabled:opacity-40">
          保存回看
        </button>
        <p role="status" className="text-sm text-muted" data-testid="review-status">
          {state === "saved" && "已保存"}
          {state === "failed" && "保存失败：浏览器存储不可用，内容还在这里，可以再试一次"}
        </p>
      </div>
    </section>
  );
}

const stableMoods = (m: readonly string[]) => [...m].sort().join("|");
