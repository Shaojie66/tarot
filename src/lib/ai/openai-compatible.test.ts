import { describe, expect, it } from "vitest";
import { AIError, type GenerateEvent, type GenerateRequest } from "./provider";
import { createOpenAICompatibleProvider, schemaInstruction } from "./openai-compatible";

const enc = new TextEncoder();
const sse = (...chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
const delta = (content: string, finish: string | null = null) => ({ choices: [{ delta: { content }, finish_reason: finish }] });

function fake(body: string | null, status = 200, onRequest?: (url: string, init: RequestInit) => void) {
  return (async (url: string, init: RequestInit) => {
    onRequest?.(url, init);
    if (body === null) throw new TypeError("network down");
    return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(body)); c.close(); } }), { status });
  }) as unknown as typeof fetch;
}

const models = { fast: "fast-model", deep: "deep-model" };
const req: GenerateRequest = { tier: "fast", system: "SYS", prompt: "PROMPT", maxTokens: 123, jsonSchema: { type: "object", properties: { crisis: { type: "boolean" } } } };
const schema = req.jsonSchema!;

async function run(provider: ReturnType<typeof createOpenAICompatibleProvider>, r = req) {
  const events: GenerateEvent[] = [];
  let error: unknown;
  try {
    for await (const e of provider.stream(r)) events.push(e);
  } catch (e) {
    error = e;
  }
  return { events, error };
}

describe("OpenAI 兼容 provider", () => {
  it("流式拼接文本，结束时给出 done；请求按 tier 选模型、带 schema 说明与 json_object", async () => {
    let captured: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | null = null;
    const provider = createOpenAICompatibleProvider({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1/",
      models,
      fetch: fake(sse(delta('{"cri'), delta('sis":false}', "stop")), 200, (url, init) => {
        captured = { url, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> };
      }),
    });
    const { events, error } = await run(provider);
    expect(error).toBeUndefined();
    expect(events).toEqual([
      { type: "text", delta: '{"cri' },
      { type: "text", delta: 'sis":false}' },
      { type: "done", text: '{"crisis":false}', stopReason: "end" },
    ]);
    expect(captured!.url).toBe("https://api.example.com/v1/chat/completions");
    expect(captured!.headers.authorization).toBe("Bearer sk-test");
    expect(captured!.body).toMatchObject({ model: "fast-model", stream: true, max_tokens: 123, response_format: { type: "json_object" } });
    expect(captured!.body.temperature).toBeUndefined();
    const system = (captured!.body.messages as { role: string; content: string }[])[0].content;
    expect(system).toContain("SYS");
    expect(system).toContain(schemaInstruction(schema));
    expect(provider.model("deep")).toBe("deep-model");
  });

  it("deep 档用 deep 模型；temperature 与 json_schema 模式可配；无 schema 时不传 response_format", async () => {
    const bodies: Record<string, unknown>[] = [];
    const mk = (jsonMode: "json_object" | "json_schema" | "none") =>
      createOpenAICompatibleProvider({ apiKey: "k", baseURL: "https://x", models, temperature: 0.2, jsonMode, fetch: fake(sse(delta("{}", "stop")), 200, (_u, init) => bodies.push(JSON.parse(init.body as string))) });
    await run(mk("json_schema"), { ...req, tier: "deep" });
    await run(mk("json_object"), { ...req, jsonSchema: undefined });
    expect(bodies[0]).toMatchObject({ model: "deep-model", temperature: 0.2, response_format: { type: "json_schema" } });
    expect(bodies[1].response_format).toBeUndefined();
  });

  it("finish_reason=length → max_tokens；content_filter → refusal", async () => {
    const mk = (finish: string) => createOpenAICompatibleProvider({ apiKey: "k", baseURL: "https://x", models, fetch: fake(sse(delta("{", finish))) });
    expect((await run(mk("length"))).events.at(-1)).toMatchObject({ type: "done", stopReason: "max_tokens" });
    expect((await run(mk("content_filter"))).events.at(-1)).toEqual({ type: "refusal" });
  });

  it("忽略非 JSON 的保活行与 reasoning 片段", async () => {
    const body = ": keep-alive\n\n" + sse({ choices: [{ delta: { reasoning_content: "思考…" }, finish_reason: null }] }, delta("{}", "stop"));
    const { events } = await run(createOpenAICompatibleProvider({ apiKey: "k", baseURL: "https://x", models, fetch: fake(body) }));
    expect(events.at(-1)).toMatchObject({ type: "done", text: "{}" });
    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [503, "overloaded"],
    [400, "bad_request"],
    [418, "unknown"],
  ])("HTTP %i → %s", async (status, kind) => {
    const { error } = await run(createOpenAICompatibleProvider({ apiKey: "k", baseURL: "https://x", models, fetch: fake("", status) }));
    expect(error).toBeInstanceOf(AIError);
    expect((error as AIError).kind).toBe(kind);
  });

  it("网络错误 → network；已取消 → aborted", async () => {
    expect(((await run(createOpenAICompatibleProvider({ apiKey: "k", baseURL: "https://x", models, fetch: fake(null) }))).error as AIError).kind).toBe("network");
    const controller = new AbortController();
    controller.abort();
    const aborting = (async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    const { error } = await run(createOpenAICompatibleProvider({ apiKey: "k", baseURL: "https://x", models, fetch: aborting }), { ...req, signal: controller.signal });
    expect((error as AIError).kind).toBe("aborted");
  });
});
