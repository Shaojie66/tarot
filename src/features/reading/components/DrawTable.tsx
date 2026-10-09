"use client";

import { useRef, useState } from "react";
import { CardImage } from "@/components/CardImage";
import { getCard } from "@/features/cards/cards";
import type { DeckId } from "@/features/cards/deck";
import type { DrawnCard } from "@/features/draw/draw";
import type { Spread } from "../spread";

const HOLD_MS = 1200;
const MIN_HOLD_MS = 400;
const FAN_SIZE = 7;

interface DrawTableProps {
  spread: Spread;
  deck: DeckId;
  cards: DrawnCard[] | null;
  revealed: number;
  onShuffled: () => void;
  onReveal: (count: number) => void;
  onQuickDraw: () => void;
}

/** 洗牌（长按）→ 点选抽牌（每点一张就翻开一张）。牌在洗牌结束时已经由 crypto 固定，点哪张只决定翻牌节奏。 */
export function DrawTable({ spread, deck, cards, revealed, onShuffled, onReveal, onQuickDraw }: DrawTableProps) {
  const [shuffling, setShuffling] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const holdStart = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const total = spread.positions.length;

  function finishShuffle() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setShuffling(false);
    onShuffled();
  }

  function startHold() {
    if (cards) return;
    setHint(null);
    holdStart.current = Date.now();
    setShuffling(true);
    timer.current = setTimeout(finishShuffle, HOLD_MS);
  }

  function endHold() {
    if (!timer.current) return;
    if (Date.now() - holdStart.current >= MIN_HOLD_MS) return finishShuffle();
    clearTimeout(timer.current);
    timer.current = null;
    setShuffling(false);
    setHint("按住久一点，让牌洗开");
  }

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-3 gap-3" aria-label="牌阵">
        {spread.positions.map((position, i) => {
          const drawn = cards?.[i];
          const flipped = !!drawn && i < revealed;
          const card = drawn ? getCard(drawn.cardId) : null;
          const side = card && drawn ? (drawn.reversed ? card.reversed : card.upright) : null;
          return (
            <li key={position.key} className="text-center">
              <p className="mb-2 text-xs text-muted">{position.label}</p>
              <div className="flip">
                <div className="flip-inner" data-flipped={flipped}>
                  <div className="flip-face card-back" aria-hidden />
                  {/* 牌固定后就渲染牌面（背面朝外、对读屏隐藏），翻牌时图片已加载好 */}
                  {card && drawn && (
                    <div className="flip-face flip-front" aria-hidden={!flipped}>
                      <CardImage card={card} reversed={drawn.reversed} deck={deck} sizes="30vw" />
                    </div>
                  )}
                </div>
              </div>
              {card && side && flipped && (
                <div className="mt-2" data-testid={`slot-${i}`}>
                  <p className="font-serif text-sm">
                    {card.nameZh}
                    {drawn?.reversed && <span className="text-muted">（逆位）</span>}
                  </p>
                  <p className="text-xs text-accent">{side.keywords.join(" · ")}</p>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {!cards && (
        <div className="flex flex-col items-center gap-4">
          <div className={`flex justify-center ${shuffling ? "shuffling" : ""}`} aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="card-back -mx-3 w-14" style={{ transform: `rotate(${(i - 2) * 4}deg)` }} />
            ))}
          </div>
          <button
            type="button"
            className="touch-none select-none rounded-full bg-accent px-6 py-3 text-bg"
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onPointerCancel={endHold}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
                e.preventDefault();
                finishShuffle();
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {shuffling ? "洗牌中…" : "按住洗牌"}
          </button>
          <p className="h-4 text-xs text-muted" role="status">
            {hint ?? "心里默念你的问题，按住按钮洗牌"}
          </p>
          <button type="button" onClick={onQuickDraw} className="text-sm text-muted underline underline-offset-4 hover:text-ink">
            快速抽牌
          </button>
        </div>
      )}

      {cards && revealed < total && (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted" role="status">
            凭直觉点 {total - revealed} 张牌
          </p>
          <div className="flex justify-center" role="group" aria-label="牌堆">
            {Array.from({ length: FAN_SIZE - revealed }, (_, i) => (
              <button
                key={i}
                type="button"
                aria-label="抽这张牌"
                onClick={() => onReveal(revealed + 1)}
                className="card-back -mx-2 w-12 transition-transform hover:-translate-y-2 focus-visible:-translate-y-2"
              />
            ))}
          </div>
          <button type="button" onClick={() => onReveal(total)} className="text-sm text-muted underline underline-offset-4 hover:text-ink">
            全部翻开
          </button>
        </div>
      )}
    </div>
  );
}
