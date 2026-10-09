// OpenAI 兼容接口（/chat/completions，SSE 流式）的 provider：DeepSeek、通义、Kimi、本地 Ollama / vLLM 等都能用。
// 只在服务端使用：key 来自环境变量，不进浏览器 bundle。
//
// 这类接口通常只保证 json_object，不保证按 JSON Schema 输出，所以：
//   - 把 schema 附在 system 里，要求只输出一个 JSON 对象；
//   - 输出的容错与校验在业务层（features/reading/ai.ts）：多余字段会被丢弃，硬约束（牌面一致、禁词、crisis）一条不降。

import { AIError, type AIProvider, type GenerateEvent, type GenerateRequest } from "./provider";
import type { ModelTier } from "./models";

export interface OpenAICompatibleOptions {
  apiKey: string;
  /** 例如 https://api.deepseek.com 或 https://api.openai.com/v1；不要带 /chat/completions */
  baseURL: string;
  models: Record<ModelTier, string>;
  /** 不设就不传（有些模型不接受该参数） */
  temperature?: number;
  /** json_object：要求 JSON 但不校验 schema（默认，兼容面最广）；json_schema：OpenAI 严格结构化输出；none：不传 response_format */
  jsonMode?: "json_object" | "json_schema" | "none";
  fetch?: typeof fetch;
}

export function schemaInstruction(schema: Record<string, unknown>): string {
  return [
    "## 输出格式（必须严格遵守）",
    "只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释文字。",
    "字段按下面 JSON Schema 的 properties 顺序输出（第一个字段必须是 crisis）；不要输出 schema 里没有的字段；数组长度、字段类型都要符合 schema。",
    JSON.stringify(schema),
  ].join("\n");
}

function mapStatus(status: number): AIError {
  if (status === 401 || status === 403) return new AIError("auth");
  if (status === 429) return new AIError("rate_limit");
  if (status === 408 || status === 504) return new AIError("timeout");
  if (status >= 500) return new AIError("overloaded");
  if (status === 400 || status === 404 || status === 422) return new AIError("bad_request", `HTTP ${status}`);
  return new AIError("unknown");
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): AIProvider {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseURL.replace(/\/+$/, "");
  return {
    model: (tier) => options.models[tier],
    async *stream(request: GenerateRequest): AsyncIterable<GenerateEvent> {
      const schema = request.jsonSchema;
      const jsonMode = schema ? (options.jsonMode ?? "json_object") : "none";
      const system = schema ? `${request.system}\n\n${schemaInstruction(schema)}` : request.system;
      const body: Record<string, unknown> = {
        model: options.models[request.tier],
        stream: true,
        max_tokens: request.maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: request.prompt },
        ],
      };
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (jsonMode === "json_object") body.response_format = { type: "json_object" };
      if (jsonMode === "json_schema") body.response_format = { type: "json_schema", json_schema: { name: "output", strict: true, schema } };

      let res: Response;
      try {
        res = await doFetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        throw new AIError(request.signal?.aborted || (error as Error).name === "AbortError" ? "aborted" : "network");
      }
      if (!res.ok || !res.body) throw mapStatus(res.status);

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let text = "";
      let finish: string | null = null;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            let choice: { delta?: { content?: string | null }; finish_reason?: string | null } | undefined;
            try {
              choice = (JSON.parse(payload) as { choices?: (typeof choice)[] }).choices?.[0];
            } catch {
              continue; // 个别服务会夹杂非 JSON 的保活行
            }
            if (choice?.delta?.content) {
              text += choice.delta.content;
              yield { type: "text", delta: choice.delta.content };
            }
            if (choice?.finish_reason) finish = choice.finish_reason;
          }
        }
      } catch (error) {
        throw new AIError(request.signal?.aborted || (error as Error).name === "AbortError" ? "aborted" : "network");
      }
      if (finish === "content_filter") {
        yield { type: "refusal" };
        return;
      }
      yield { type: "done", text, stopReason: finish === "length" ? "max_tokens" : "end" };
    },
  };
}
