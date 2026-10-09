import { z } from "zod";

/** 与起问主题一一对应：事业 / 关系 / 自我 / 去留 */
export const TOPICS = ["career", "relationship", "self", "crossroads"] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS: Record<Topic, string> = {
  career: "事业",
  relationship: "关系",
  self: "自我",
  crossroads: "去留",
};

const text = z.string().trim().min(2);
const keyword = z.string().trim().min(1);

export const cardSideSchema = z.strictObject({
  keywords: z.tuple([keyword, keyword, keyword]),
  meaning: text,
  career: text,
  relationship: text,
  self: text,
  crossroads: text,
  question: text.endsWith("？"),
});

export const cardEntrySchema = z.strictObject({
  id: z.string(),
  nameZh: text,
  nameEn: text,
  number: z.int().min(0).max(21),
  upright: cardSideSchema,
  reversed: cardSideSchema,
});

export type CardSide = z.infer<typeof cardSideSchema>;
export type CardEntry = z.infer<typeof cardEntrySchema>;

/** 文案红线：牌义不得出现断言式预测用语。 */
export const BANNED_PHRASES = ["一定", "注定", "必然", "必将", "肯定会", "命中注定"] as const;
