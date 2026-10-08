import { ALL_CARD_IDS, isCardId, type CardId } from "@/features/cards/ids";
import { cryptoRandomInt, shuffle, type RandomInt } from "./random";

export interface DrawnCard {
  cardId: CardId;
  /** 牌阵中的位置序号，从 0 开始 */
  position: number;
  reversed: boolean;
}

export interface DrawOptions {
  count: number;
  allowReversed: boolean;
  randomInt?: RandomInt;
}

export function drawCards({ count, allowReversed, randomInt = cryptoRandomInt }: DrawOptions): DrawnCard[] {
  if (!Number.isInteger(count) || count < 1 || count > ALL_CARD_IDS.length) {
    throw new RangeError(`count out of range: ${count}`);
  }
  return shuffle(ALL_CARD_IDS, randomInt)
    .slice(0, count)
    .map((cardId, position) => ({
      cardId,
      position,
      reversed: allowReversed && randomInt(2) === 1,
    }));
}

/** 服务端校验客户端传来的抽牌结果：牌 ID 合法、不重复、位置连续。 */
export function isValidDraw(cards: unknown, expectedCount: number): cards is DrawnCard[] {
  if (!Array.isArray(cards) || cards.length !== expectedCount) return false;
  const seen = new Set<string>();
  return cards.every((card, index) => {
    if (typeof card !== "object" || card === null) return false;
    const { cardId, position, reversed } = card as Record<string, unknown>;
    if (!isCardId(cardId) || seen.has(cardId)) return false;
    seen.add(cardId);
    return position === index && typeof reversed === "boolean";
  });
}
