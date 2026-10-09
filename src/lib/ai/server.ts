// 服务端取 provider 的唯一入口。没有 key 时返回 null，调用方走本地模式。

import { createAnthropicProvider } from "./anthropic";
import type { AIProvider } from "./provider";

let cached: { key: string; provider: AIProvider } | null = null;

export function getProvider(): AIProvider | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  if (cached?.key !== key) cached = { key, provider: createAnthropicProvider(key) };
  return cached.provider;
}
