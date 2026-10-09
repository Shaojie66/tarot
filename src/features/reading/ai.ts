// AI 解读与问题改写的业务流程（服务端）。只依赖 provider 接口，测试用 mock provider。

import { ALL_CARD_IDS } from "@/features/cards/ids";
import type { Topic } from "@/features/cards/schema";
import { AIError, type AIErrorKind, type AIProvider, type GenerateRequest } from "@/lib/ai/provider";
import {
  CONTENT_VERSION,
  perspectiveBodySchema,
  readingBodySchema,
  resultMatchesDraw,
  type ReadingBody,
  type ReadingRequest,
  type PerspectiveBody,
  type ReadingResult,
  type Tone,
} from "./contract";
import { findForbiddenPhrase } from "./guard";
import { describeIssues, normalizePerspectiveBody, normalizeReadingBody, normalizeSection, parseModelJson, repairNote } from "./model-output";
import { TopLevelSections } from "./json-sections";
import { PROMPT_VERSION, perspectiveSystemPrompt, perspectiveUserPrompt, readingSystemPrompt, readingUserPrompt, rewriteSystemPrompt, rewriteUserPrompt } from "./prompts";

export type ReadingErrorCode = Exclude<AIErrorKind, "aborted" | "bad_request"> | "invalid_output" | "unavailable" | "cancelled" | "forbidden" | "bad_request" | "protocol";

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

type Judged<T> = { type: "ok"; body: T } | { type: "crisis" } | { type: "invalid"; reasons: string[] };

/**
 * 判定一次完整输出。crisis 必须是布尔值（缺失 / 类型错误一律无效，不容错——这是安全字段）；
 * 其余字段先做无损整理（丢多余字段、拉回类型），再按硬约束校验。
 */
function judgeReading(text: string, stopReason: "end" | "max_tokens", request: ReadingRequest): Judged<ReadingBody> {
  if (stopReason === "max_tokens") return { type: "invalid", reasons: ["输出被截断（太长）"] };
  const value = parseModelJson(text) as { crisis?: unknown } | undefined;
  if (value === undefined || typeof value !== "object" || value === null) return { type: "invalid", reasons: ["不是 JSON 对象"] };
  if (typeof value.crisis !== "boolean") return { type: "invalid", reasons: ["crisis 缺失或不是布尔值"] };
  if (value.crisis) return { type: "crisis" };
  const parsed = readingBodySchema.safeParse(normalizeReadingBody(value));
  if (!parsed.success) return { type: "invalid", reasons: describeIssues(parsed.error.issues) };
  const body = parsed.data;
  if (!resultMatchesDraw(body, request)) return { type: "invalid", reasons: ["cards 的 cardId / position / reversed 与输入不一致"] };
  const texts = [body.overall, ...body.cards.map((c) => c.text), ...body.interpretations, body.action, body.question];
  if (findForbiddenPhrase(texts)) return { type: "invalid", reasons: ["含断言式用语"] };
  return { type: "ok", body };
}

/** 不流式地跑完一次生成，取最终文本（重试用）。provider 抛错照常向上抛。 */
async function collectOnce(provider: AIProvider, req: GenerateRequest): Promise<{ kind: "text"; text: string; stopReason: "end" | "max_tokens" } | { kind: "refusal" }> {
  for await (const event of provider.stream(req)) {
    if (event.type === "refusal") return { kind: "refusal" };
    if (event.type === "done") return { kind: "text", text: event.text, stopReason: event.stopReason };
  }
  throw new AIError("network");
}

export async function* runAiReading(
  request: ReadingRequest,
  provider: AIProvider,
  signal?: AbortSignal,
): AsyncGenerator<ReadingStreamEvent> {
  // 调用方已经取消：不启动 provider
  if (signal?.aborted) {
    yield { type: "error", code: "cancelled" };
    return;
  }
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
          const raw = tryParse(section.raw);
          const value = section.key === "crisis" ? raw : normalizeSection(section.key, raw);
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
      // done：先判第一次的输出；不合格就带着原因让模型重试一次（只重试一次，不循环）
      let judged = judgeReading(event.text, event.stopReason, request);
      if (judged.type === "invalid" && !signal?.aborted) {
        const second = await collectOnce(provider, { ...generate, prompt: generate.prompt + repairNote(judged.reasons) });
        if (second.kind === "refusal") {
          yield { type: "refusal" };
          return;
        }
        judged = judgeReading(second.text, second.stopReason, request);
      }
      if (signal?.aborted) {
        yield { type: "error", code: "cancelled" };
        return;
      }
      if (judged.type === "crisis") {
        yield { type: "crisis" };
        return;
      }
      if (judged.type === "invalid") {
        yield { type: "error", code: "invalid_output" };
        return;
      }
      yield {
        type: "result",
        result: { ...judged.body, source: "ai" },
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
  if (signal?.aborted) return { type: "error", code: "cancelled" };
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
      const value = parseModelJson(event.text) as { crisis?: unknown; question?: unknown } | undefined;
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


export const PERSPECTIVE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["crisis", "overall", "interpretations", "question"],
  properties: {
    crisis: { type: "boolean" },
    overall: str,
    interpretations: { type: "array", items: str },
    question: str,
  },
} as const;

export type PerspectiveOutcome =
  | { type: "ok"; body: PerspectiveBody; versions: Versions }
  | { type: "crisis" }
  | { type: "refusal" }
  | { type: "error"; code: ReadingErrorCode };

/**
 * 换视角：一次请求、整体校验后才返回（内容短，不做章节流式）。
 * 与原解读一样：crisis 必须是布尔，缺失 / 类型错误视为无效；输出不含 action，不会触碰原小行动。
 */
function judgePerspective(text: string, stopReason: "end" | "max_tokens", previous: readonly string[]): Judged<PerspectiveBody> {
  if (stopReason === "max_tokens") return { type: "invalid", reasons: ["输出被截断（太长）"] };
  const value = parseModelJson(text) as { crisis?: unknown } | undefined;
  if (value === undefined || typeof value !== "object" || value === null) return { type: "invalid", reasons: ["不是 JSON 对象"] };
  if (typeof value.crisis !== "boolean") return { type: "invalid", reasons: ["crisis 缺失或不是布尔值"] };
  if (value.crisis) return { type: "crisis" };
  // 多余字段（包括模型自作主张加的 action）在整理时被丢弃：视角本来就不含 action，原小行动不会被碰
  const parsed = perspectiveBodySchema.safeParse(normalizePerspectiveBody(value));
  if (!parsed.success) return { type: "invalid", reasons: describeIssues(parsed.error.issues) };
  const body = parsed.data;
  if (findForbiddenPhrase([body.overall, ...body.interpretations, body.question])) return { type: "invalid", reasons: ["含断言式用语"] };
  // 两种读法必须有区别；也不能原样重复上一次给过的读法
  if (body.interpretations[0] === body.interpretations[1]) return { type: "invalid", reasons: ["两个读法相同"] };
  if (body.interpretations.some((t) => previous.includes(t))) return { type: "invalid", reasons: ["重复了之前给过的读法"] };
  return { type: "ok", body };
}

/**
 * 换视角：一次请求、整体校验后才返回（内容短，不做章节流式）。不合格时带着原因重试一次。
 * 与原解读一样：crisis 必须是布尔，缺失 / 类型错误视为无效。
 */
export async function runPerspective(
  request: ReadingRequest,
  tone: Tone,
  previous: readonly string[],
  provider: AIProvider,
  signal?: AbortSignal,
): Promise<PerspectiveOutcome> {
  if (signal?.aborted) return { type: "error", code: "cancelled" };
  const generate: GenerateRequest = {
    tier: "deep",
    system: perspectiveSystemPrompt(),
    prompt: perspectiveUserPrompt(request, tone, previous),
    jsonSchema: PERSPECTIVE_JSON_SCHEMA,
    maxTokens: 2000,
    signal,
  };
  try {
    let out = await collectOnce(provider, generate);
    if (out.kind === "refusal") return { type: "refusal" };
    let judged = judgePerspective(out.text, out.stopReason, previous);
    if (judged.type === "invalid" && !signal?.aborted) {
      out = await collectOnce(provider, { ...generate, prompt: generate.prompt + repairNote(judged.reasons) });
      if (out.kind === "refusal") return { type: "refusal" };
      judged = judgePerspective(out.text, out.stopReason, previous);
    }
    if (signal?.aborted) return { type: "error", code: "cancelled" };
    if (judged.type === "crisis") return { type: "crisis" };
    if (judged.type === "invalid") return { type: "error", code: "invalid_output" };
    return { type: "ok", body: judged.body, versions: { content: CONTENT_VERSION, prompt: PROMPT_VERSION, model: provider.model("deep") } };
  } catch (error) {
    return { type: "error", code: signal?.aborted ? "cancelled" : errorCode(error) };
  }
}
