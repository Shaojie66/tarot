// Anthropic 实现。只在服务端使用：API key 来自 .env.local，不进浏览器 bundle。

import Anthropic from "@anthropic-ai/sdk";
import { MODELS, type ModelTier } from "./models";
import { AIError, type AIProvider, type GenerateEvent, type GenerateRequest } from "./provider";

function toAIError(error: unknown): AIError {
  if (error instanceof AIError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new AIError("aborted");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AIError("auth");
  }
  if (error instanceof Anthropic.RateLimitError) return new AIError("rate_limit");
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AIError("timeout");
  if (error instanceof Anthropic.APIConnectionError) return new AIError("network");
  if (error instanceof Anthropic.InternalServerError) return new AIError("overloaded");
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new AIError("bad_request", error.message);
  }
  if (error instanceof Error && error.name === "AbortError") return new AIError("aborted");
  return new AIError("unknown");
}

export function createAnthropicProvider(apiKey: string): AIProvider {
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  return {
    model: (tier: ModelTier) => MODELS[tier],
    async *stream(request: GenerateRequest): AsyncIterable<GenerateEvent> {
      try {
        const stream = client.messages.stream(
          {
            model: MODELS[request.tier],
            max_tokens: request.maxTokens,
            system: request.system,
            messages: [{ role: "user", content: request.prompt }],
            output_config: {
              // 短任务，低 effort 降低延迟
              effort: "low",
              ...(request.jsonSchema ? { format: { type: "json_schema", schema: request.jsonSchema } } : {}),
            },
          },
          { signal: request.signal },
        );
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", delta: event.delta.text };
          }
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") {
          yield { type: "refusal" };
          return;
        }
        const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
        yield { type: "done", text, stopReason: message.stop_reason === "max_tokens" ? "max_tokens" : "end" };
      } catch (error) {
        throw toAIError(error);
      }
    },
  };
}
