"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CardImage } from "@/components/CardImage";
import { getCard } from "@/features/cards/cards";
import { useSettings } from "@/features/settings/settings";
import { buildDailyReading } from "./daily-reading";
import { drawDaily, todaysEntry, type DailyOutcome } from "./daily";

/** 进入页面不自动抽牌：要用户点一下，今天的牌才被固定下来。已经抽过则直接显示原牌。 */
export function DailyCard() {
  const settings = useSettings();
  const [outcome, setOutcome] = useState<DailyOutcome | null | "none">(null);

  // 服务端渲染没有 localStorage：挂载后再读今天的牌
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const entry = todaysEntry();
      setOutcome(entry ? { entry, fresh: false, persisted: true } : "none");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (outcome === null) return <p className="py-10 text-center text-sm text-muted">正在翻开今天的牌…</p>;

  if (outcome === "none") {
    return (
      <div className="space-y-4 py-6 text-center">
        <p className="text-sm leading-relaxed text-muted">每天一张，不用问问题。抽到之后今天就固定下来，刷新也不会变。</p>
        <button
          type="button"
          onClick={() => setOutcome(drawDaily({ allowReversed: settings.allowReversed, deckId: settings.deckId }))}
          className="rounded-full bg-accent px-6 py-2.5 text-bg"
        >
          抽今天的牌
        </button>
      </div>
    );
  }

  const { entry, fresh, persisted } = outcome;
  const reading = buildDailyReading(entry.cardId, entry.reversed);
  return (
    <article className="space-y-6" aria-labelledby="daily-title" data-testid="daily-card">
      {!persisted && (
        <p role="alert" className="rounded-lg bg-surface px-4 py-2 text-xs leading-relaxed text-muted">
          这个浏览器没有允许保存，今天这张牌刷新后可能会变。
        </p>
      )}
      <p className="text-xs text-muted" data-testid="daily-day">
        {entry.dayKey}
        {!fresh && " · 今天已经抽过，这是同一张"}
      </p>
      <div className="mx-auto w-44">
        <CardImage card={getCard(entry.cardId)} reversed={entry.reversed} deck={entry.deckId} priority sizes="176px" />
      </div>
      <header className="text-center">
        <h2 id="daily-title" className="diary-title">
          {reading.nameZh}
          {reading.reversed && "（逆位）"}
        </h2>
        <p className="mt-1 text-sm text-muted">{reading.keywords.join(" · ")}</p>
      </header>
      <p className="diary">{reading.meaning}</p>
      <p className="question-line">{reading.question}</p>
      <p className="text-sm leading-relaxed text-muted">{reading.notice}</p>
      <p className="text-xs leading-relaxed text-muted">
        牌是随机抽的，不预测今天会发生什么。想认真聊一件事，可以去{" "}
        <Link href="/reading" className="text-accent underline underline-offset-4">
          抽三张牌
        </Link>
        。
      </p>
    </article>
  );
}
