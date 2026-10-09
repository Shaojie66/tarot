// 固定解读评测（mock，不联网）：40 个用例，四主题各 10 个。
// 硬检查：结构、牌面一致、文案红线、行动非空、反问以问号结尾。真实模型评测见 evals/live/。

import { describe, expect, it } from "vitest";
import { runAiReading, runPerspective } from "@/features/reading/ai";
import { TONES, readingRequestSchema, readingResultSchema, resultMatchesDraw, type ReadingRequest } from "@/features/reading/contract";
import { findForbiddenPhrase } from "@/features/reading/guard";
import { buildLocalReading } from "@/features/reading/local";
import { modelBody, mockProvider, streamed } from "@/test/mock-provider";
import data from "./reading/cases.json";

const requests: [string, ReadingRequest][] = data.cases.map((c) => [
  c.id,
  readingRequestSchema.parse({
    spreadId: "three-card",
    topic: c.topic,
    originalQuestion: c.question,
    question: c.question,
    selfReading: c.selfReading,
    cards: c.cards,
  }),
]);

describe("eval set", () => {
  it("has 40 cases, 10 per topic", () => {
    expect(requests).toHaveLength(40);
    const byTopic = Object.groupBy(requests, ([, r]) => r.topic);
    for (const group of Object.values(byTopic)) expect(group).toHaveLength(10);
  });
});

describe.each(requests)("local reading %s", (_id, request) => {
  it("passes all hard checks", () => {
    const result = readingResultSchema.parse(buildLocalReading(request));
    expect(result.source).toBe("local");
    expect(resultMatchesDraw(result, request)).toBe(true);
    expect(findForbiddenPhrase([result.overall, ...result.cards.map((c) => c.text), ...result.interpretations, result.action, result.question])).toBeNull();
    expect(result.interpretations[0]).not.toBe(result.interpretations[1]);
    expect(result.action.length).toBeGreaterThan(8);
    expect(result.question).toMatch(/？$/);
    if (request.selfReading) expect(result.overall).toContain(request.selfReading);
  });
});

describe("AI pipeline replays a well-formed model output for every case", () => {
  it.each(requests)("%s", async (_id, request) => {
    const provider = mockProvider(streamed(JSON.stringify({ crisis: false, ...modelBody(buildLocalReading(request)) })));
    const events = [];
    for await (const e of runAiReading(request, provider)) events.push(e);
    expect(events.at(-1)).toMatchObject({ type: "result", result: { source: "ai" } });
  });
});

describe("换视角管道回放：40 例 × 3 种视角", () => {
  const cases = requests.flatMap(([id, request]) => TONES.map((tone) => [`${id}/${tone}`, request, tone] as const));
  it.each(cases)("%s", async (_name, request, tone) => {
    const local = buildLocalReading(request);
    const provider = mockProvider([
      {
        type: "done",
        text: JSON.stringify({
          crisis: false,
          overall: `（${tone}）${local.overall}`,
          interpretations: [`（${tone}）${local.interpretations[0]}`, `（${tone}）${local.interpretations[1]}`],
          question: local.question,
        }),
        stopReason: "end",
      },
    ]);
    const outcome = await runPerspective(request, tone, local.interpretations, provider);
    expect(outcome.type).toBe("ok");
  });
});
