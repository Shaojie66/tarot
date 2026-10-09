import { describe, expect, it } from "vitest";
import { mockProvider, type Step } from "@/test/mock-provider";
import { createAnthropicProvider } from "./anthropic";
import { withDeadline } from "./deadline";
import { AIError, type AIProvider, type GenerateRequest } from "./provider";

const req: GenerateRequest = { tier: "fast", system: "s", prompt: "p", maxTokens: 10 };

async function drain(provider: AIProvider, request = req) {
  const events = [];
  let error: unknown;
  try {
    for await (const e of provider.stream(request)) events.push(e);
  } catch (e) {
    error = e;
  }
  return { events, error };
}

describe("withDeadline", () => {
  it("事件正常到达时原样透传", async () => {
    const steps: Step[] = [{ type: "text", delta: "a" }, { type: "done", text: "a", stopReason: "end" }];
    const { events, error } = await drain(withDeadline(mockProvider(steps), { totalMs: 500, idleMs: 200 }));
    expect(error).toBeUndefined();
    expect(events).toHaveLength(2);
  });

  it("静默超时：中止上游并抛 timeout", async () => {
    const inner = mockProvider([{ type: "text", delta: "{" }, { type: "hang" }]);
    const started = Date.now();
    const { events, error } = await drain(withDeadline(inner, { totalMs: 5_000, idleMs: 30 }));
    expect(events).toEqual([{ type: "text", delta: "{" }]);
    expect(error).toMatchObject({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(inner.calls[0].signal?.aborted).toBe(true);
  });

  it("调用方已取消：不启动 provider", async () => {
    const inner = mockProvider([{ type: "text", delta: "a" }]);
    const controller = new AbortController();
    controller.abort();
    const { error } = await drain(withDeadline(inner, { totalMs: 500, idleMs: 200 }), { ...req, signal: controller.signal });
    expect(error).toMatchObject({ kind: "aborted" });
    expect(inner.calls).toHaveLength(0);
  });

  it("调用方中途取消：向上游传播，抛 aborted", async () => {
    const inner = mockProvider([{ type: "hang" }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const { error } = await drain(withDeadline(inner, { totalMs: 5_000, idleMs: 5_000 }), { ...req, signal: controller.signal });
    expect(error).toBeInstanceOf(AIError);
    expect(error).toMatchObject({ kind: "aborted" });
    expect(inner.calls[0].signal?.aborted).toBe(true);
  });
});

// 实际安装的 SDK + 内存假 fetch：响应头与首个 SSE 事件返回后流挂起。SDK 自己的 timeout 管不到这一步。
describe("Anthropic adapter + 假 SSE 流", () => {
  const message = { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  const sse = (event: string, data: object) => new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  function fakeFetch(behaviour: "hang-after-start" | "overloaded") {
    const state = { calls: 0, upstreamAborted: false };
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      state.calls++;
      init?.signal?.addEventListener("abort", () => (state.upstreamAborted = true));
      if (behaviour === "overloaded") {
        return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), {
          status: 529,
          headers: { "content-type": "application/json", "retry-after-ms": "1" },
        });
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(sse("message_start", { type: "message_start", message }));
          // 之后不再发送，也不关闭
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    return { state, fetchImpl };
  }

  it("headers 已返回但流挂起：期限到达后超时并中止上游，只发了一次请求", async () => {
    const { state, fetchImpl } = fakeFetch("hang-after-start");
    const provider = withDeadline(createAnthropicProvider("sk-test", { fetch: fetchImpl, baseURL: "http://fake.local" }), { totalMs: 2_000, idleMs: 60 });
    const started = Date.now();
    const { error } = await drain(provider);
    expect(error).toMatchObject({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(state.calls).toBe(1);
    expect(state.upstreamAborted).toBe(true);
  });

  it("529 过载映射为 overloaded；SDK 自动重试 1 次，共 2 次上游请求", async () => {
    const { state, fetchImpl } = fakeFetch("overloaded");
    const provider = createAnthropicProvider("sk-test", { fetch: fetchImpl, baseURL: "http://fake.local" });
    const { error } = await drain(provider);
    expect(error).toMatchObject({ kind: "overloaded" });
    expect(state.calls).toBe(2);
  });
});
