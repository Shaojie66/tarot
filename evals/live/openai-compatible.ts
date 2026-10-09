// 评测专用：OpenAI 兼容接口的 provider（如 DeepSeek），用来在没有 Anthropic key 时跑通
// "协议 / 流式 / 校验 / 安全门控"的真实链路。它不是产品代码，不进 src/，
// 它的结果只证明流程可用，不能算 claude-haiku / claude-sonnet 的模型质量验收。

import { AIError, type AIProvider, type GenerateEvent, type GenerateRequest } from "@/lib/ai/provider";

export interface OpenAICompatibleOptions {
  apiKey: string;
  baseURL: string;
  model: string;
}

export function createOpenAICompatibleProvider({ apiKey, baseURL, model }: OpenAICompatibleOptions): AIProvider {
  return {
    model: () => model,
    async *stream(request: GenerateRequest): AsyncIterable<GenerateEvent> {
      // 该接口只保证 json_object：把 schema 写进 system，并要求 crisis 在最前
      const system = request.jsonSchema
        ? `${request.system}\n\n## 输出格式\n只输出一个 JSON 对象，不要任何其他文字。必须符合下面的 JSON Schema，字段按 properties 中的顺序输出（crisis 第一个）。严格遵守：不要输出 schema 之外的任何字段；cards 的数量必须与输入的牌数完全相同、每项只含 cardId / position / reversed / text 这四个键，绝对不要加 name、title、keywords 或任何其他键；interpretations 必须恰好是 2 个字符串（不是数组套数组）；所有文本字段都必须是非空字符串。\n\n${JSON.stringify(request.jsonSchema)}`
        : request.system;
      let res: Response;
      try {
        res = await fetch(`${baseURL}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            stream: true,
            max_tokens: request.maxTokens,
            temperature: 0.3,
            messages: [
              { role: "system", content: system },
              { role: "user", content: request.prompt },
            ],
            ...(request.jsonSchema ? { response_format: { type: "json_object" } } : {}),
          }),
          signal: request.signal,
        });
      } catch (error) {
        throw new AIError(request.signal?.aborted || (error as Error).name === "AbortError" ? "aborted" : "network");
      }
      if (!res.ok || !res.body) {
        throw new AIError(res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limit" : res.status >= 500 ? "overloaded" : "unknown");
      }
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
            const choice = (JSON.parse(payload) as { choices?: { delta?: { content?: string }; finish_reason?: string | null }[] }).choices?.[0];
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
