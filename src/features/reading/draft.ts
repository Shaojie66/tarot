// 进行中流程草稿（localStorage）的版本化与校验。草稿是不可信输入：浏览器里的旧版本、手改、
// 半写入都可能让它"是合法 JSON 但缺字段"。校验不过就丢弃，用户回到干净的起点，已完成的记录不受影响。

import { z } from "zod";
import { TOPICS } from "@/features/cards/schema";
import { drawnCardSchema, readingChoiceSchema, readingResultSchema, checkRequest, resultMatchesDraw } from "./contract";
import type { FlowState } from "./flow";
import { DEFAULT_SPREAD } from "./spread";

/** 草稿格式版本。改 FlowState 的持久化形状时递增，旧版本按 migrateDraft 处理或丢弃。 */
export const DRAFT_VERSION = 2;

const STAGES = ["topic", "question", "rewrite", "draw", "self", "reading", "result", "crisis"] as const;

const flowStateSchema = z.object({
  stage: z.enum(STAGES),
  topic: z.enum(TOPICS).nullable(),
  mode: z.enum(["local", "ai"]).nullable().default(null),
  originalQuestion: z.string(),
  question: z.string(),
  suggestion: z.string().nullable(),
  cards: z.array(drawnCardSchema).nullable(),
  revealed: z.int().min(0),
  selfReading: z.string(),
  generation: z.object({
    status: z.enum(["idle", "generating", "done", "refused", "failed", "cancelled"]),
    source: z.enum(["ai", "local"]).nullable(),
    requestId: z.int().min(0),
    error: z.string().nullable(),
    sections: z.record(z.string(), z.unknown()),
  }),
  result: readingResultSchema.nullable(),
  versions: z.object({ content: z.string(), prompt: z.string().nullable(), model: z.string().nullable() }).nullable(),
  choice: readingChoiceSchema,
  recordId: z.string().nullable(),
  createdAt: z.string().nullable(),
  saveStatus: z.enum(["idle", "saving", "saved", "failed"]),
  saveNonce: z.int().min(0).default(0),
});

/** 跨字段一致性：阶段需要的数据必须在。 */
function consistent(s: z.infer<typeof flowStateSchema>): boolean {
  const needsCards = ["self", "reading", "result"].includes(s.stage);
  if (needsCards && !s.cards) return false;
  if (s.cards) {
    const request = {
      spreadId: DEFAULT_SPREAD,
      topic: s.topic ?? TOPICS[0],
      originalQuestion: "x",
      question: "x",
      selfReading: "",
      cards: s.cards,
    };
    if (checkRequest(request)) return false;
    if (s.revealed > s.cards.length) return false;
    if (s.result && !resultMatchesDraw(s.result, request)) return false;
  }
  if (s.stage === "result" && (!s.result || !s.recordId || !s.createdAt)) return false;
  if (["question", "rewrite", "draw", "self", "reading", "result"].includes(s.stage) && !s.topic) return false;
  return true;
}

/** 解析 localStorage 里的原始字符串。无法确认可用时返回 null（调用方清掉它）。 */
export function parseDraft(raw: string | null): FlowState | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || (json as { v?: unknown }).v !== DRAFT_VERSION) return null;
  const parsed = flowStateSchema.safeParse((json as { state?: unknown }).state);
  if (!parsed.success || !consistent(parsed.data)) return null;
  return parsed.data as unknown as FlowState;
}

/**
 * v1 草稿（没有版本包装）：形状与现在接近，但行动默认 accepted 是应用自动设置的，
 * 无法区分用户是否真的点过。保守处理为"未决定"，不冒充用户的明确选择。
 */
export function migrateLegacyDraft(raw: string | null): FlowState | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = flowStateSchema.safeParse(json);
  if (!parsed.success || !consistent(parsed.data)) return null;
  const state = parsed.data as unknown as FlowState;
  return { ...state, choice: downgradeLegacyChoice(state.choice) };
}

export function downgradeLegacyChoice(choice: FlowState["choice"]): FlowState["choice"] {
  return choice.action.status === "accepted" ? { ...choice, action: { status: "undecided", text: "" } } : choice;
}
