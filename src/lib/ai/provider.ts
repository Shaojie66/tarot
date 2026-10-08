// 模型供应商接口。业务代码只依赖这里，以后切国内模型只换实现。
// Anthropic 实现在 M2 落地（流式 + 结构化输出 + 拒答处理）。

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
  | { type: "done"; text: string }
  /** 模型安全拒答：前端走温和兜底文案，不显示错误 */
  | { type: "refusal" };

export interface AIProvider {
  stream(request: GenerateRequest): AsyncIterable<GenerateEvent>;
}
