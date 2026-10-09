import { describe, expect, it } from "vitest";
import { modelBody, mockProvider, streamed, type Step } from "@/test/mock-provider";
import { runAiReading, runRewrite, type ReadingStreamEvent } from "./ai";
import { readingRequestSchema } from "./contract";
import { buildLocalReading } from "./local";

const request = readingRequestSchema.parse({
  spreadId: "three-card",
  topic: "career",
  originalQuestion: "工作好累",
  question: "这份工作里什么在消耗我？",
  selfReading: "",
  cards: [
    { cardId: "the-tower", position: 0, reversed: false },
    { cardId: "four-of-swords", position: 1, reversed: true },
    { cardId: "ace-of-wands", position: 2, reversed: false },
  ],
});

const body = modelBody(buildLocalReading(request));
const good = JSON.stringify({ crisis: false, ...body });

async function collect(steps: Step[], signal?: AbortSignal) {
  const provider = mockProvider(steps);
  const events: ReadingStreamEvent[] = [];
  for await (const e of runAiReading(request, provider, signal)) events.push(e);
  return { events, provider };
}

describe("runAiReading", () => {
  it("streams validated sections, then a validated result", async () => {
    const { events, provider } = await collect(streamed(good));
    expect(events.filter((e) => e.type === "section").map((e) => e.type === "section" && e.key)).toEqual([
      "overall",
      "cards",
      "interpretations",
      "action",
      "question",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "result", result: { source: "ai" }, versions: { prompt: "v1", model: "mock-model" } });
    expect(provider.calls[0].prompt).toContain("cardId: the-tower | position: 0 | reversed: false");
    expect(provider.calls[0].jsonSchema).toBeDefined();
  });

  it.each([
    ["auth", "auth"],
    ["timeout", "timeout"],
    ["network", "network"],
    ["rate_limit", "rate_limit"],
    ["overloaded", "overloaded"],
  ] as const)("maps provider error %s", async (kind, code) => {
    const { events } = await collect([{ type: "text", delta: '{"crisis":false,' }, { type: "throw", kind }]);
    expect(events.at(-1)).toEqual({ type: "error", code });
    expect(events.some((e) => e.type === "result")).toBe(false);
  });

  it("treats a stream that ends without done as a broken connection", async () => {
    const { events } = await collect(streamed(good).slice(0, 5));
    expect(events.at(-1)).toEqual({ type: "error", code: "network" });
  });

  it("rejects truncated JSON", async () => {
    const { events } = await collect([{ type: "done", text: good.slice(0, good.length - 20), stopReason: "end" }]);
    expect(events).toEqual([{ type: "error", code: "invalid_output" }]);
  });

  it("rejects output cut by max_tokens even if it parses", async () => {
    const { events } = await collect([{ type: "done", text: good, stopReason: "max_tokens" }]);
    expect(events).toEqual([{ type: "error", code: "invalid_output" }]);
  });

  it("rejects a result whose cards do not match the draw", async () => {
    const swapped = JSON.stringify({ crisis: false, ...body, cards: body.cards.map((c, i) => (i === 0 ? { ...c, cardId: "the-sun" } : c)) });
    const { events } = await collect(streamed(swapped));
    expect(events.some((e) => e.type === "section" && e.key === "cards")).toBe(false);
    expect(events.at(-1)).toEqual({ type: "error", code: "invalid_output" });
  });

  it("rejects reversed flags that differ from the draw", async () => {
    const flipped = JSON.stringify({ crisis: false, ...body, cards: body.cards.map((c) => ({ ...c, reversed: !c.reversed })) });
    const { events } = await collect(streamed(flipped));
    expect(events.at(-1)).toEqual({ type: "error", code: "invalid_output" });
  });

  it("rejects fatalistic phrasing but allows 不一定", async () => {
    const bad = JSON.stringify({ crisis: false, ...body, overall: "你注定会离开这份工作。" });
    expect((await collect(streamed(bad))).events.at(-1)).toEqual({ type: "error", code: "invalid_output" });
    const ok = JSON.stringify({ crisis: false, ...body, overall: "答案不一定在外面，也可能在你心里。" });
    expect((await collect(streamed(ok))).events.at(-1)).toMatchObject({ type: "result" });
  });

  it("passes through a refusal without falling back", async () => {
    const { events } = await collect([{ type: "text", delta: "{" }, { type: "refusal" }]);
    expect(events).toEqual([{ type: "refusal" }]);
  });

  it("stops early when the model flags a crisis", async () => {
    const crisis = JSON.stringify({ crisis: true, overall: "", cards: [], interpretations: [], action: "", question: "" });
    const { events } = await collect(streamed(crisis, 4));
    expect(events).toEqual([{ type: "crisis" }]);
  });

  it("reports cancelled and never a result after the caller aborts", async () => {
    const controller = new AbortController();
    const steps: Step[] = [{ type: "text", delta: good.slice(0, 40) }, { type: "hang" }, ...streamed(good)];
    setTimeout(() => controller.abort(), 10);
    const { events } = await collect(steps, controller.signal);
    expect(events.at(-1)).toEqual({ type: "error", code: "cancelled" });
    expect(events.some((e) => e.type === "result")).toBe(false);
  });
});

describe("runRewrite", () => {
  const run = (steps: Step[]) => runRewrite("我会不会被裁员", "career", mockProvider(steps));

  it("returns an open question", async () => {
    const text = JSON.stringify({ crisis: false, question: "面对裁员的担心，我能先做些什么？" });
    expect(await run([{ type: "done", text, stopReason: "end" }])).toEqual({ type: "ok", question: "面对裁员的担心，我能先做些什么？" });
  });

  it("rejects predictive or malformed rewrites", async () => {
    for (const question of ["我会不会被裁员？", "没有问号", ""]) {
      const text = JSON.stringify({ crisis: false, question });
      expect(await run([{ type: "done", text, stopReason: "end" }])).toEqual({ type: "error", code: "invalid_output" });
    }
  });

  it("passes crisis and refusal through", async () => {
    expect(await run([{ type: "done", text: '{"crisis":true,"question":""}', stopReason: "end" }])).toEqual({ type: "crisis" });
    expect(await run([{ type: "refusal" }])).toEqual({ type: "refusal" });
  });

  it("maps errors", async () => {
    expect(await run([{ type: "throw", kind: "auth" }])).toEqual({ type: "error", code: "auth" });
  });
});
