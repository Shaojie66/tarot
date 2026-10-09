// 服务端取 provider 的唯一入口。没有配置时返回 null，调用方走本地模式。
//
// 配置（环境变量，写在 .env.local）：
//   Anthropic（默认）：ANTHROPIC_API_KEY
//   OpenAI 兼容接口（DeepSeek / OpenAI / 通义 / Kimi / Ollama …）：
//     OPENAI_API_KEY、OPENAI_BASE_URL（默认 https://api.openai.com/v1）、OPENAI_MODEL（必填）、
//     OPENAI_MODEL_DEEP（可选，换视角用；不设则同 OPENAI_MODEL）、OPENAI_TEMPERATURE（可选）、
//     OPENAI_JSON_MODE（json_object 默认 | json_schema | none）
//   AI_PROVIDER=anthropic | openai-compatible 可显式指定；不指定时：有 ANTHROPIC_API_KEY 用 Anthropic，否则有 OPENAI_API_KEY 用兼容接口。

import { createAnthropicProvider } from "./anthropic";
import { withDeadline } from "./deadline";
import { createOpenAICompatibleProvider } from "./openai-compatible";
import type { AIProvider } from "./provider";

/** 整个流 90 秒、静默 30 秒就放弃（SDK 自带的 timeout 在响应头之后不再生效）。 */
const STREAM_DEADLINE = { totalMs: 90_000, idleMs: 30_000 };

type Env = Record<string, string | undefined>;

export type ProviderConfig =
  | { kind: "anthropic"; apiKey: string }
  | { kind: "openai-compatible"; apiKey: string; baseURL: string; model: string; modelDeep: string; temperature?: number; jsonMode: "json_object" | "json_schema" | "none" };

/** 从环境变量解析 provider 配置；没配或配得不完整返回 null（本地模式）。纯函数，便于测试。 */
export function resolveProviderConfig(env: Env = process.env): ProviderConfig | null {
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const choice = env.AI_PROVIDER?.trim().toLowerCase();
  const kind = choice === "anthropic" ? "anthropic" : choice === "openai-compatible" || choice === "openai" ? "openai-compatible" : anthropicKey ? "anthropic" : openaiKey ? "openai-compatible" : null;

  if (kind === "anthropic") return anthropicKey ? { kind, apiKey: anthropicKey } : null;
  if (kind === "openai-compatible") {
    const model = env.OPENAI_MODEL?.trim();
    if (!openaiKey || !model) return null;
    const baseURL = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
    try {
      new URL(baseURL);
    } catch {
      return null;
    }
    const temperature = env.OPENAI_TEMPERATURE?.trim() ? Number(env.OPENAI_TEMPERATURE) : undefined;
    const jsonMode = env.OPENAI_JSON_MODE === "json_schema" || env.OPENAI_JSON_MODE === "none" ? env.OPENAI_JSON_MODE : "json_object";
    return {
      kind,
      apiKey: openaiKey,
      baseURL,
      model,
      modelDeep: env.OPENAI_MODEL_DEEP?.trim() || model,
      temperature: temperature !== undefined && Number.isFinite(temperature) ? temperature : undefined,
      jsonMode,
    };
  }
  return null;
}

function build(config: ProviderConfig): AIProvider {
  const inner =
    config.kind === "anthropic"
      ? createAnthropicProvider(config.apiKey)
      : createOpenAICompatibleProvider({ apiKey: config.apiKey, baseURL: config.baseURL, models: { fast: config.model, deep: config.modelDeep }, temperature: config.temperature, jsonMode: config.jsonMode });
  return withDeadline(inner, STREAM_DEADLINE);
}

let cached: { signature: string; provider: AIProvider } | null = null;

export function getProvider(): AIProvider | null {
  const config = resolveProviderConfig();
  if (!config) return null;
  const signature = JSON.stringify(config);
  if (cached?.signature !== signature) cached = { signature, provider: build(config) };
  return cached.provider;
}
