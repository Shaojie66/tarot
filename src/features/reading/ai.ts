// AI 解读与问题改写的业务流程（服务端）。只依赖 provider 接口，测试用 mock provider。

import { ALL_CARD_IDS } from "@/features/cards/ids";
import type { Topic } from "@/features/cards/schema";
import { AIError, type AIErrorKind, type AIProvider, type GenerateRequest } from "@/lib/ai/provider";
import {
  CONTENT_VERSION,
  readingBodySchema,
  resultMatchesDraw,
  type ReadingBody,
  type ReadingRequest,
  type ReadingResult,
} from "./contract";
import { findForbiddenPhrase } from "./guard";
import { TopLevelSections } from "./json-sections";
import { PROMPT_VERSION, readingSystemPrompt, readingUserPrompt, rewriteSystemPrompt, rewriteUserPrompt } from "./prompts";

export type ReadingErrorCode = Exclude<AIErrorKind, "aborted" | "bad_request"> | "invalid_output" | "unavailable" | "cancelled" | "forbidden";

export interface Versions {
  content: string;
  prompt: string | null;
  model: string | null;
}

type SectionKey = keyof ReadingBody;

export type ReadingStreamEvent =
  | { type: "section"; key: SectionKey; value: unknown }
  | { type: "result"; result: ReadingResult; versions: Versions }
  | { type: "crisis" }
  | { type: "refusal" }
  | { type: "error"; code: ReadingErrorCode };

const str = { type: "string" } as const;

/** 结构化输出 schema。只用基础关键字（type / properties / required / enum / items），兼容供应商支持的子集。 */
export const READING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["crisis", "overall", "cards", "interpretations", "action", "question"],
  properties: {
    crisis: { type: "boolean" },
    overall: str,
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cardId", "position", "reversed", "text"],
        properties: {
          cardId: { type: "string", enum: [...ALL_CARD_IDS] },
          position: { type: "integer" },
          reversed: { type: "boolean" },
          text: str,
        },
      },
    },
    interpretations: { type: "array", items: str },
    action: str,
    question: str,
  },
} as const;

export const REWRITE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["crisis", "question"],
  properties: { crisis: { type: "boolean" }, question: str },
} as const;

function errorCode(error: unknown): ReadingErrorCode {
  if (!(error instanceof AIError)) return "unknown";
  if (error.kind === "aborted") return "cancelled";
  if (error.kind === "bad_request") return "unknown";
  return error.kind;
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** 校验单个章节；cards 章节还要与原抽牌逐张一致。 */
function checkSection(key: SectionKey, value: unknown, request: ReadingRequest): boolean {
  const schema = readingBodySchema.shape[key];
  const parsed = schema.safeParse(value);
  if (!parsed.success) return false;
  if (key === "cards" && !resultMatchesDraw({ cards: parsed.data as ReadingBody["cards"] }, request)) return false;
  const texts = typeof parsed.data === "string" ? [parsed.data] : JSON.stringify(parsed.data).match(/"[^"]*"/g) ?? [];
  return findForbiddenPhrase(texts) === null;
}

/** 最终结果校验：结构、牌面一致、文案红线。不合格返回 null。 */
export function validateReadingOutput(value: unknown, request: ReadingRequest): ReadingBody | null {
  const parsed = readingBodySchema.safeParse(value);
  if (!parsed.success) return null;
  const body = parsed.data;
  if (!resultMatchesDraw(body, request)) return null;
  const texts = [body.overall, ...body.cards.map((c) => c.text), ...body.interpretations, body.action, body.question];
  if (findForbiddenPhrase(texts)) return null;
  return body;
}

export async function* runAiReading(
  request: ReadingRequest,
  provider: AIProvider,
  signal?: AbortSignal,
): AsyncGenerator<ReadingStreamEvent> {
  // 内部控制器：模型标记 crisis 时提前停止生成
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const generate: GenerateRequest = {
    tier: "fast",
    system: readingSystemPrompt(),
    prompt: readingUserPrompt(request),
    jsonSchema: READING_JSON_SCHEMA,
    maxTokens: 4000,
    signal: controller.signal,
  };
  const sections = new TopLevelSections();
  // 危机门控：确认本次输出的 crisis 是布尔 false 之前，章节只缓冲不放行（不依赖字段顺序）。
  let crisisCleared = false;
  const held: { key: SectionKey; value: unknown }[] = [];
  try {
    for await (const event of provider.stream(generate)) {
      if (signal?.aborted) {
        yield { type: "error", code: "cancelled" };
        return;
      }
      if (event.type === "refusal") {
        yield { type: "refusal" };
        return;
      }
      if (event.type === "text") {
        for (const section of sections.push(event.delta)) {
          const value = tryParse(section.raw);
          if (section.key === "crisis") {
            if (typeof value !== "boolean" || crisisCleared) {
              // 类型错误，或重复出现的标记：整个输出无效
              controller.abort();
              yield { type: "error", code: "invalid_output" };
              return;
            }
            if (value) {
              controller.abort();
              held.length = 0;
              yield { type: "crisis" };
              return;
            }
            crisisCleared = true;
            for (const item of held.splice(0)) yield { type: "section", ...item };
            continue;
          }
          if (section.key in readingBodySchema.shape && checkSection(section.key as SectionKey, value, request)) {
            const item = { key: section.key as SectionKey, value };
            if (crisisCleared) yield { type: "section", ...item };
            else held.push(item);
          }
        }
        continue;
      }
      // done
      if (event.stopReason === "max_tokens") {
        yield { type: "error", code: "invalid_output" };
        return;
      }
      const value = tryParse(event.text) as { crisis?: unknown } | undefined;
      if (typeof value?.crisis !== "boolean") {
        yield { type: "error", code: "invalid_output" };
        return;
      }
      if (value.crisis) {
        yield { type: "crisis" };
        return;
      }
      delete value.crisis;
      const body = validateReadingOutput(value, request);
      if (!body) {
        yield { type: "error", code: "invalid_output" };
        return;
      }
      yield {
        type: "result",
        result: { ...body, source: "ai" },
        versions: { content: CONTENT_VERSION, prompt: PROMPT_VERSION, model: provider.model("fast") },
      };
      return;
    }
    // 流结束却没有 done：断流
    yield { type: "error", code: signal?.aborted ? "cancelled" : "network" };
  } catch (error) {
    yield { type: "error", code: signal?.aborted ? "cancelled" : errorCode(error) };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export type RewriteOutcome =
  | { type: "ok"; question: string }
  | { type: "crisis" }
  | { type: "refusal" }
  | { type: "error"; code: ReadingErrorCode };

export async function runRewrite(
  question: string,
  topic: Topic,
  provider: AIProvider,
  signal?: AbortSignal,
): Promise<RewriteOutcome> {
  try {
    for await (const event of provider.stream({
      tier: "fast",
      system: rewriteSystemPrompt(),
      prompt: rewriteUserPrompt(question, topic),
      jsonSchema: REWRITE_JSON_SCHEMA,
      maxTokens: 1000,
      signal,
    })) {
      if (event.type === "refusal") return { type: "refusal" };
      if (event.type !== "done") continue;
      if (event.stopReason === "max_tokens") return { type: "error", code: "invalid_output" };
      const value = tryParse(event.text) as { crisis?: unknown; question?: unknown } | undefined;
      if (typeof value?.crisis !== "boolean") return { type: "error", code: "invalid_output" };
      if (value.crisis) return { type: "crisis" };
      const rewritten = typeof value?.question === "string" ? value.question.trim() : "";
      if (rewritten.length < 4 || rewritten.length > 60 || !/[？?]$/.test(rewritten)) {
        return { type: "error", code: "invalid_output" };
      }
      if (/会不会|能不能成|是否会/.test(rewritten) || findForbiddenPhrase([rewritten])) {
        return { type: "error", code: "invalid_output" };
      }
      return { type: "ok", question: rewritten };
    }
    return { type: "error", code: "network" };
  } catch (error) {
    return { type: "error", code: errorCode(error) };
  }
}

