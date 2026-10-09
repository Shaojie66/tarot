// 模型供应商接口。业务代码只依赖这里，以后切其他模型只换实现。

import type { ModelTier } from "./models";

export interface GenerateRequest {
  tier: ModelTier;
  system: string;
  prompt: string;
  /** 结构化输出的 JSON Schema；不传则返回纯文本 */
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
  signal?: AbortSignal;
}

export type GenerateEvent =
  | { type: "text"; delta: string }
  /** stopReason 为 max_tokens 时文本被截断，结构化结果不可信 */
  | { type: "done"; text: string; stopReason: "end" | "max_tokens" }
  /** 模型安全拒答：前端走温和兜底文案，不当作技术错误 */
  | { type: "refusal" };

export interface AIProvider {
  readonly model: (tier: ModelTier) => string;
  stream(request: GenerateRequest): AsyncIterable<GenerateEvent>;
}

export type AIErrorKind = "auth" | "rate_limit" | "timeout" | "network" | "overloaded" | "bad_request" | "aborted" | "unknown";

/** provider 实现把供应商 SDK 的异常统一转换成这个类型再抛出。 */
export class AIError extends Error {
  constructor(
    readonly kind: AIErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = "AIError";
  }
}
