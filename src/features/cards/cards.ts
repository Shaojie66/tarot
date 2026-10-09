import cupsData from "../../../content/cards/cups.json";
import majorData from "../../../content/cards/major.json";
import pentaclesData from "../../../content/cards/pentacles.json";
import swordsData from "../../../content/cards/swords.json";
import wandsData from "../../../content/cards/wands.json";
import { ALL_CARD_IDS, isCardId, type CardId, type Suit } from "./ids";
import { cardEntrySchema, type CardEntry } from "./schema";

export type Arcana = "major" | "minor";

export interface Card extends Omit<CardEntry, "id"> {
  id: CardId;
  arcana: Arcana;
  suit: Suit | null;
}

export const SUIT_INFO: Record<Suit, { nameZh: string; element: string; theme: string }> = {
  wands: { nameZh: "权杖", element: "火", theme: "行动、热情与创造" },
  cups: { nameZh: "圣杯", element: "水", theme: "情感、关系与直觉" },
  swords: { nameZh: "宝剑", element: "风", theme: "思维、冲突与真相" },
  pentacles: { nameZh: "星币", element: "土", theme: "物质、工作与身体" },
};

const SOURCES: { suit: Suit | null; data: unknown }[] = [
  { suit: null, data: majorData },
  { suit: "wands", data: wandsData },
  { suit: "cups", data: cupsData },
  { suit: "swords", data: swordsData },
  { suit: "pentacles", data: pentaclesData },
];

function load(): ReadonlyMap<CardId, Card> {
  const map = new Map<CardId, Card>();
  for (const { suit, data } of SOURCES) {
    for (const raw of cardEntrySchema.array().parse(data)) {
      if (!isCardId(raw.id)) throw new Error(`Unknown card id in content: ${raw.id}`);
      if (map.has(raw.id)) throw new Error(`Duplicate card id in content: ${raw.id}`);
      map.set(raw.id, { ...raw, id: raw.id, arcana: suit ? "minor" : "major", suit });
    }
  }
  const missing = ALL_CARD_IDS.filter((id) => !map.has(id));
  if (missing.length) throw new Error(`Missing card content: ${missing.join(", ")}`);
  return map;
}

const CARDS = load();

/** 按标准顺序（大阿卡纳 → 权杖 → 圣杯 → 宝剑 → 星币）返回全部牌。 */
export function getAllCards(): Card[] {
  return ALL_CARD_IDS.map((id) => CARDS.get(id)!);
}

export function getCard(id: CardId): Card {
  return CARDS.get(id)!;
}

export function findCard(id: string): Card | undefined {
  return isCardId(id) ? CARDS.get(id) : undefined;
}
