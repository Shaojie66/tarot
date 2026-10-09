// 服务端取 provider 的唯一入口。没有 key 时返回 null，调用方走本地模式。

import { createAnthropicProvider } from "./anthropic";
import { withDeadline } from "./deadline";
import type { AIProvider } from "./provider";

/** 整个流 90 秒、静默 30 秒就放弃（SDK 自带的 timeout 在响应头之后不再生效）。 */
const STREAM_DEADLINE = { totalMs: 90_000, idleMs: 30_000 };

let cached: { key: string; provider: AIProvider } | null = null;

export function getProvider(): AIProvider | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  if (cached?.key !== key) cached = { key, provider: withDeadline(createAnthropicProvider(key), STREAM_DEADLINE) };
  return cached.provider;
}
