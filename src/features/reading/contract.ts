// 解读数据契约：AI 与本地模式共用同一套请求 / 结果 / 记录结构（决策 001）。
// provider 层保持通用，这里放业务类型。

import { z } from "zod";
import { isCardId, type CardId } from "@/features/cards/ids";
import { TOPICS } from "@/features/cards/schema";
import { isValidDraw } from "@/features/draw/draw";
import { SPREAD_IDS, getSpread } from "./spread";

/** 牌义内容版本。改动 content/cards 的语义时手动更新，记录里留档。 */
export const CONTENT_VERSION = "cards-2026-10-09";
export const RECORD_SCHEMA_VERSION = 1;

export const QUESTION_MAX = 300;
export const SELF_READING_MAX = 200;

const cardId = z.string().refine(isCardId, "unknown card id") as unknown as z.ZodType<CardId>;

export const drawnCardSchema = z.strictObject({
  cardId,
  position: z.int().min(0),
  reversed: z.boolean(),
});

export const readingRequestSchema = z.strictObject({
  spreadId: z.enum(SPREAD_IDS),
  topic: z.enum(TOPICS),
  /** 用户最初输入或选择的问题 */
  originalQuestion: z.string().trim().min(1).max(QUESTION_MAX),
  /** 用户确认后的问题（可能经过改写） */
  question: z.string().trim().min(1).max(QUESTION_MAX),
  /** 可选自解："你第一眼看到了什么？" */
  selfReading: z.string().trim().max(SELF_READING_MAX).default(""),
  cards: z.array(drawnCardSchema),
});

export type ReadingRequest = z.infer<typeof readingRequestSchema>;

const sentence = z.string().trim().min(2).max(600);

export const cardReadingSchema = z.strictObject({
  cardId,
  position: z.int().min(0),
  reversed: z.boolean(),
  text: sentence,
});

/** 模型直接产出的部分（不含 source），也是本地模板的产出形状。 */
export const readingBodySchema = z.strictObject({
  overall: sentence,
  cards: z.array(cardReadingSchema).min(1),
  interpretations: z.tuple([sentence, sentence]),
  action: z.string().trim().min(4).max(120),
  question: z.string().trim().min(4).max(120).regex(/[？?]$/, "反问须以问号结尾"),
});

export const readingResultSchema = readingBodySchema.extend({
  source: z.enum(["local", "ai"]),
});

export type ReadingBody = z.infer<typeof readingBodySchema>;
export type ReadingResult = z.infer<typeof readingResultSchema>;

export const readingChoiceSchema = z.strictObject({
  /** 选中的读法下标；null 表示都不像 */
  interpretation: z.union([z.literal(0), z.literal(1)]).nullable(),
  /** 标记为"不符合我的情况"的读法下标 */
  rejected: z.array(z.union([z.literal(0), z.literal(1)])),
  action: z.strictObject({
    status: z.enum(["accepted", "edited", "skipped"]),
    text: z.string().trim().max(200),
  }),
});

export type ReadingChoice = z.infer<typeof readingChoiceSchema>;

export const readingRecordSchema = z.strictObject({
  id: z.string().min(8),
  schemaVersion: z.literal(RECORD_SCHEMA_VERSION),
  createdAt: z.iso.datetime(),
  request: readingRequestSchema,
  result: readingResultSchema,
  choice: readingChoiceSchema,
  versions: z.strictObject({
    content: z.string(),
    prompt: z.string().nullable(),
    model: z.string().nullable(),
  }),
});

export type ReadingRecord = z.infer<typeof readingRecordSchema>;

/** 请求的业务校验：牌阵决定牌数和是否允许逆位，抽牌合法。 */
export function checkRequest(request: ReadingRequest): string | null {
  const spread = getSpread(request.spreadId);
  if (!isValidDraw(request.cards, spread.positions.length)) return "invalid draw";
  if (!spread.allowReversed && request.cards.some((c) => c.reversed)) return "reversed not allowed";
  return null;
}

/** 结果必须逐张对应原抽牌：牌 ID、位置、正逆位都一致。模型不能换牌。 */
export function resultMatchesDraw(body: Pick<ReadingBody, "cards">, request: ReadingRequest): boolean {
  if (body.cards.length !== request.cards.length) return false;
  return request.cards.every((drawn, i) => {
    const got = body.cards[i];
    return got.cardId === drawn.cardId && got.position === drawn.position && got.reversed === drawn.reversed;
  });
}
