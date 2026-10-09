import type { CardId } from "./ids";

// 牌组 = 一套牌面图。新增 AI 重绘牌组时在这里登记，图放 public/decks/<id>/。

export const DECKS = {
  "rws-1909": { name: "莱德-韦特 1909 原版", width: 600, height: 1035 },
} as const;

export type DeckId = keyof typeof DECKS;

export const DEFAULT_DECK: DeckId = "rws-1909";

export function cardImageSrc(cardId: CardId, deck: DeckId = DEFAULT_DECK): string {
  return `/decks/${deck}/${cardId}.webp`;
}
