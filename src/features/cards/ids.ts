// 78 张牌的稳定 ID。牌义、图片、AI 输入都以此为键，改名等于数据迁移。

export const MAJOR_ARCANA = [
  "the-fool",
  "the-magician",
  "the-high-priestess",
  "the-empress",
  "the-emperor",
  "the-hierophant",
  "the-lovers",
  "the-chariot",
  "strength",
  "the-hermit",
  "wheel-of-fortune",
  "justice",
  "the-hanged-man",
  "death",
  "temperance",
  "the-devil",
  "the-tower",
  "the-star",
  "the-moon",
  "the-sun",
  "judgement",
  "the-world",
] as const;

export const SUITS = ["wands", "cups", "swords", "pentacles"] as const;

export const RANKS = [
  "ace",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "page",
  "knight",
  "queen",
  "king",
] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type MajorCardId = (typeof MAJOR_ARCANA)[number];
export type MinorCardId = `${Rank}-of-${Suit}`;
export type CardId = MajorCardId | MinorCardId;

export const ALL_CARD_IDS: readonly CardId[] = [
  ...MAJOR_ARCANA,
  ...SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}-of-${suit}` as const)),
];

const CARD_ID_SET: ReadonlySet<string> = new Set(ALL_CARD_IDS);

export function isCardId(value: unknown): value is CardId {
  return typeof value === "string" && CARD_ID_SET.has(value);
}
