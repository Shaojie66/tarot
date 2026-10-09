"use client";

import Link from "next/link";
import { useState } from "react";
import { getCard } from "@/features/cards/cards";
import type { ReadingChoice, ReadingResult } from "../contract";
import type { SaveStatus } from "../flow";
import type { Spread } from "../spread";

const LENS_LABELS = ["读法一", "读法二"] as const;

interface ResultViewProps {
  spread: Spread;
  result: ReadingResult;
  choice: ReadingChoice;
  saveStatus: SaveStatus;
  recordId: string | null;
  onRetrySave: () => void;
  onChoose: (index: 0 | 1 | null) => void;
  onToggleRejected: (index: 0 | 1) => void;
  onAction: (status: ReadingChoice["action"]["status"], text: string) => void;
  onRestart: () => void;
}

export function ResultView({ spread, result, choice, saveStatus, recordId, onRetrySave, onChoose, onToggleRejected, onAction, onRestart }: ResultViewProps) {
  const [editing, setEditing] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const unsaved = saveStatus === "failed" || saveStatus === "saving";
  const [draft, setDraft] = useState(choice.action.text);

  return (
    <article className="space-y-10" aria-labelledby="result-title">
      <header className="space-y-3">
        <p className="eyebrow rise">{result.source === "ai" ? "AI 解读" : "本地解读"}</p>
        <h2 id="result-title" className="sr-only">
          解读
        </h2>
        <p className="diary rise" style={{ "--i": 1 } as React.CSSProperties}>{result.overall}</p>
      </header>

      <section aria-labelledby="lens-title" className="space-y-1">
        <h3 id="lens-title" className="font-serif text-lg pb-2">
          两种读法，哪个更像你？
        </h3>
        {result.interpretations.map((text, i) => {
          const index = i as 0 | 1;
          const chosen = choice.interpretation === index;
          const rejected = choice.rejected.includes(index);
          return (
            <div
              key={index}
              className={`hairline py-5 ${rejected ? "opacity-55" : ""}`}
            >
              <p className={`eyebrow ${chosen ? "!text-accent" : ""}`}>{LENS_LABELS[index]}{chosen && " · 你选了这个"}</p>
              <p className="diary mt-2">{text}</p>
              <div className="mt-3 flex gap-3 text-sm">
                <button
                  type="button"
                  aria-pressed={chosen}
                  disabled={rejected}
                  onClick={() => onChoose(chosen ? null : index)}
                  className={`min-h-9 rounded-full border px-4 ${chosen ? "border-accent bg-accent text-bg" : "border-line"} disabled:opacity-40`}
                >
                  {chosen ? "更像我 ✓" : "更像我"}
                </button>
                <button
                  type="button"
                  aria-pressed={rejected}
                  onClick={() => onToggleRejected(index)}
                  className="min-h-9 px-2 text-muted underline underline-offset-4"
                >
                  {rejected ? "已标记不符合" : "这不符合我的情况"}
                </button>
              </div>
            </div>
          );
        })}
        <p className="hairline pt-4 text-xs leading-relaxed text-muted">都不像也没关系，牌只是一个观察角度，解释权在你。</p>
      </section>

      <section aria-labelledby="cards-title">
        <h3 id="cards-title" className="font-serif text-lg">
          逐张看
        </h3>
        <div className="mt-2 divide-y divide-line">
          {result.cards.map((c) => {
            const card = getCard(c.cardId);
            return (
              <details key={c.cardId} className="py-3">
                <summary className="cursor-pointer text-sm">
                  <span className="text-muted">{spread.positions[c.position].label}：</span>
                  {card.nameZh}
                  {c.reversed && "（逆位）"}
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-ink/90">{c.text}</p>
              </details>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="action-title" className="hairline border-b border-line py-7">
        <h3 id="action-title" className="font-serif text-lg">
          24 小时内可以试的一小步
        </h3>
        {choice.action.status === "undecided" && <p className="mt-1 text-xs text-muted">这只是一个建议，还没决定也没关系。</p>}
        {editing ? (
          <div className="mt-2 space-y-2">
            <label htmlFor="action-edit" className="sr-only">
              修改小行动
            </label>
            <textarea
              id="action-edit"
              value={draft}
              maxLength={200}
              rows={3}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-md border border-line bg-bg p-2 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                const text = draft.trim();
                onAction(text ? "edited" : "skipped", text);
                setEditing(false);
              }}
              className="rounded-full bg-accent px-4 py-1 text-sm text-bg"
            >
              就这样
            </button>
          </div>
        ) : (
          <>
            <p className={`diary mt-3 ${choice.action.status === "skipped" ? "text-muted line-through" : choice.action.status === "undecided" ? "text-ink/80" : ""}`}>
              {choice.action.text || result.action}
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <button
                type="button"
                aria-pressed={choice.action.status === "accepted"}
                onClick={() => onAction("accepted", result.action)}
                className="min-h-9 rounded-full border border-line px-4"
              >
                {choice.action.status === "accepted" ? "就做这个 ✓" : "就做这个"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(choice.action.text || result.action);
                  setEditing(true);
                }}
                className="min-h-9 rounded-full border border-line px-4"
              >
                {choice.action.status === "edited" ? "已改成我的版本 · 再改" : "改成我的版本"}
              </button>
              <button
                type="button"
                aria-pressed={choice.action.status === "skipped"}
                onClick={() => onAction("skipped", "")}
                className="min-h-9 rounded-full border border-line px-4"
              >
                {choice.action.status === "skipped" ? "已跳过" : "这次先不做"}
              </button>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="question-title">
        <h3 id="question-title" className="eyebrow mb-3">
          留给你的问题
        </h3>
        <p className="question-line">{result.question}</p>
      </section>

      <footer className="space-y-3 border-t border-line pt-5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-muted" data-testid="save-status">
            {saveStatus === "saved" && "已保存在这台设备的浏览器里"}
            {saveStatus === "saving" && "保存中…"}
            {saveStatus === "failed" && "未保存：浏览器存储不可用"}
          </p>
          {saveStatus === "failed" && (
            <button type="button" onClick={onRetrySave} className="rounded-full border border-line px-3 py-1 text-sm">
              重试保存
            </button>
          )}
        </div>
        {saveStatus === "saved" && recordId && (
          <p className="text-xs leading-relaxed text-muted">
            之后可以到{" "}
            <Link href={`/history/${recordId}`} className="text-accent underline underline-offset-4" data-testid="open-record">
              这条记录
            </Link>{" "}
            补写感受、换个视角或导出图片。
          </p>
        )}
        {confirmRestart && unsaved ? (
          <div role="alert" className="space-y-2 rounded-lg bg-surface p-3">
            <p className="leading-relaxed">当前这次解读还没有保存成功，开始新问题后将无法找回。确定要离开吗？</p>
            <div className="flex gap-3">
              <button type="button" onClick={onRestart} className="rounded-full border border-accent px-4 py-1.5 text-accent">
                仍然开始新问题
              </button>
              <button type="button" onClick={() => setConfirmRestart(false)} className="rounded-full border border-line px-4 py-1.5">
                先留在这里
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" onClick={() => (unsaved ? setConfirmRestart(true) : onRestart())} className="rounded-full border border-accent px-4 py-1.5 text-accent">
              再问一个问题
            </button>
          </div>
        )}
      </footer>
    </article>
  );
}
