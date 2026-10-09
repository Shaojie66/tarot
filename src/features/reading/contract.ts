// 解读数据契约：AI 与本地模式共用同一套请求 / 结果 / 记录结构（决策 001）。
// provider 层保持通用，这里放业务类型。

import { z } from "zod";
import { isCardId, type CardId } from "@/features/cards/ids";
import { TOPICS } from "@/features/cards/schema";
import { DECKS } from "@/features/cards/deck";
import { INTENTS } from "@/features/profile/intent";
import { isValidDraw } from "@/features/draw/draw";
import { SPREAD_IDS, getSpread } from "./spread";

/** 牌义内容版本。改动 content/cards 的语义时手动更新，记录里留档。 */
export const CONTENT_VERSION = "cards-2026-10-09";
/** 当前写入的记录版本。v1 记录（M2 早期，无 deckId / settings）继续可读，不批量迁移，见 docs/decisions/002。 */
export const RECORD_SCHEMA_VERSION = 2;
export const LEGACY_RECORD_SCHEMA_VERSION = 1;

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
  /** 这次想要的帮助（建档 / 设置里选的；没有就是中性默认）。决定解读的语气，不改变牌与硬约束 */
  intent: z.enum(INTENTS).optional(),
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
  /**
   * 小行动：建议与决定分开。undecided = 用户还没操作（默认）；只有明确点击才变 accepted / edited / skipped。
   * 编辑时把文本清空等同 skipped。旧版曾在生成时默认写 accepted，无法证明用户点过，不得当作明确接受。
   */
  action: z.strictObject({
    status: z.enum(["undecided", "accepted", "edited", "skipped"]),
    text: z.string().trim().max(200),
  }),
});

export type ReadingChoice = z.infer<typeof readingChoiceSchema>;

export const MOODS = ["平静", "期待", "轻松", "迷茫", "焦虑", "疲惫", "难过"] as const;
export const NOTE_MAX = 2000;
export const FOLLOW_UP_NOTE_MAX = 500;

/** 后来行动是否完成，与“当时是否接受建议”（choice.action）是两件事，分开记录。 */
export const FOLLOW_UP_STATUSES = ["done", "partial", "not_done", "dropped"] as const;

/** 用户事后在历史里补充的内容：情绪标签、回看笔记、行动复盘。不存在 = 用户没有写。 */
export const reviewSchema = z.strictObject({
  moods: z
    .array(z.enum(MOODS))
    .max(3)
    .refine((m) => new Set(m).size === m.length, "duplicate mood"),
  note: z.string().max(NOTE_MAX),
  followUp: z
    .strictObject({
      status: z.enum(FOLLOW_UP_STATUSES),
      note: z.string().max(FOLLOW_UP_NOTE_MAX),
      at: z.iso.datetime(),
    })
    .nullable(),
  updatedAt: z.iso.datetime(),
});

export type Review = z.infer<typeof reviewSchema>;

/** 换个视角：同一问题与固定的牌，换一种语气再解读。 */
export const TONES = ["support", "rational", "challenge"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABELS: Record<Tone, string> = { support: "温和支持", rational: "理性拆解", challenge: "挑战提问" };
export const MAX_PERSPECTIVES = TONES.length;

export const perspectiveBodySchema = z.strictObject({
  overall: sentence,
  interpretations: z.tuple([sentence, sentence]),
  question: readingBodySchema.shape.question,
});
export type PerspectiveBody = z.infer<typeof perspectiveBodySchema>;

/** 视角快照：附加在记录上，不覆盖原解读、原小行动，也不改动用户的选择。 */
export const perspectiveSchema = z.strictObject({
  id: z.string().min(8),
  tone: z.enum(TONES),
  createdAt: z.iso.datetime(),
  source: z.literal("ai"),
  versions: z.strictObject({ content: z.string(), prompt: z.string().nullable(), model: z.string().nullable() }),
  body: perspectiveBodySchema,
});
export type Perspective = z.infer<typeof perspectiveSchema>;

const recordBase = {
  id: z.string().min(8),
  createdAt: z.iso.datetime(),
  request: readingRequestSchema,
  result: readingResultSchema,
  choice: readingChoiceSchema,
  versions: z.strictObject({
    content: z.string(),
    prompt: z.string().nullable(),
    model: z.string().nullable(),
  }),
  review: reviewSchema.optional(),
  /** 后续视角快照，每种语气最多一份 */
  perspectives: z.array(perspectiveSchema).max(MAX_PERSPECTIVES).optional(),
};

export const DECK_IDS = Object.keys(DECKS) as [keyof typeof DECKS, ...(keyof typeof DECKS)[]];

const recordV1Schema = z.strictObject({ ...recordBase, schemaVersion: z.literal(LEGACY_RECORD_SCHEMA_VERSION) });
const recordV2Schema = z.strictObject({
  ...recordBase,
  schemaVersion: z.literal(RECORD_SCHEMA_VERSION),
  /** 生成时使用的牌组；历史按它渲染，切换牌组不追改旧记录 */
  deckId: z.enum(DECK_IDS),
  /** 抽牌当时的设置快照 */
  settings: z.strictObject({ allowReversed: z.boolean() }),
});

/** 记录内部的一致性：抽牌合法、结果逐张对应抽牌、选择自洽。导入与保存都要过这一关。 */
function recordConsistency(record: z.infer<typeof recordV1Schema> | z.infer<typeof recordV2Schema>, ctx: z.RefinementCtx) {
  const spread = getSpread(record.request.spreadId);
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
  if (!isValidDraw(record.request.cards, spread.positions.length)) issue("invalid draw", ["request", "cards"]);
  else if (!resultMatchesDraw(record.result, record.request)) issue("result does not match draw", ["result", "cards"]);
  if (record.choice.interpretation !== null && record.choice.rejected.includes(record.choice.interpretation)) {
    issue("chosen interpretation is also rejected", ["choice"]);
  }
  if (record.choice.action.status === "undecided" && record.choice.action.text !== "") {
    issue("undecided action must have no text", ["choice", "action"]);
  }
  const tones = (record.perspectives ?? []).map((p) => p.tone);
  if (new Set(tones).size !== tones.length) issue("duplicate perspective tone", ["perspectives"]);
  if ("settings" in record && !record.settings.allowReversed && record.request.cards.some((c) => c.reversed)) {
    issue("reversed card but reversal disabled in snapshot", ["settings"]);
  }
}

export const readingRecordSchema = z.discriminatedUnion("schemaVersion", [recordV1Schema, recordV2Schema]).superRefine(recordConsistency);

export type ReadingRecord = z.infer<typeof recordV1Schema> | z.infer<typeof recordV2Schema>;
export type ReadingRecordV2 = z.infer<typeof recordV2Schema>;

/** 渲染用的牌组：v1 记录没有 deckId，按默认牌组显示并标注为旧记录（不伪造字段）。 */
export function recordDeck(record: ReadingRecord): { deckId: keyof typeof DECKS; legacy: boolean } {
  return "deckId" in record ? { deckId: record.deckId, legacy: false } : { deckId: DEFAULT_DECK_FOR_LEGACY, legacy: true };
}
const DEFAULT_DECK_FOR_LEGACY: keyof typeof DECKS = "rws-1909";

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
