import { describe, expect, it } from "vitest";
import { modelBody, mockProvider, streamed, type Step } from "@/test/mock-provider";
import { PERSPECTIVE_JSON_SCHEMA, READING_JSON_SCHEMA, REWRITE_JSON_SCHEMA, runAiReading, runPerspective, runRewrite, type ReadingStreamEvent } from "./ai";
import { perspectiveSystemPrompt, perspectiveUserPrompt, readingSystemPrompt, rewriteSystemPrompt } from "./prompts";
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
    expect(events.at(-1)).toMatchObject({ type: "result", result: { source: "ai" }, versions: { prompt: "v3", model: "mock-model" } });
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

  describe("危机门控（流式章节在确认 crisis:false 之前不放行）", () => {
    const withCrisis = (crisis: unknown, position: "first" | "middle" | "last") => {
      const entries: [string, unknown][] = Object.entries(body);
      const at = position === "first" ? 0 : position === "middle" ? 2 : entries.length;
      entries.splice(at, 0, ["crisis", crisis]);
      return JSON.stringify(Object.fromEntries(entries));
    };
    const kinds = (events: ReadingStreamEvent[]) => events.map((e) => e.type);

    it("crisis:true 放在最后：不先放出任何普通章节", async () => {
      const { events } = await collect(streamed(withCrisis(true, "last"), 5));
      expect(events).toEqual([{ type: "crisis" }]);
    });

    it("crisis:true 放在中间：已缓冲的章节被丢弃", async () => {
      const { events } = await collect(streamed(withCrisis(true, "middle"), 5));
      expect(events).toEqual([{ type: "crisis" }]);
    });

    it("crisis:false 在中间：之前缓冲的章节按序放行，之后的直接放行", async () => {
      const { events } = await collect(streamed(withCrisis(false, "middle"), 5));
      expect(events.filter((e) => e.type === "section").map((e) => e.type === "section" && e.key)).toEqual([
        "overall",
        "cards",
        "interpretations",
        "action",
        "question",
      ]);
      expect(kinds(events).at(-1)).toBe("result");
    });

    it("crisis:false 放在最后：确认前不放行，确认后章节一并放出，随后是结果", async () => {
      const { events } = await collect(streamed(withCrisis(false, "last"), 5));
      expect(kinds(events)).toEqual(["section", "section", "section", "section", "section", "result"]);
    });

    it.each([
      ["缺失", JSON.stringify(body)],
      ["字符串 false", withCrisis("false", "first")],
      ["数字 0", withCrisis(0, "first")],
      ["null", withCrisis(null, "first")],
    ])("crisis %s：无效输出，不展示任何章节、不产生结果", async (_name, json) => {
      const { events } = await collect(streamed(json, 5));
      expect(events).toEqual([{ type: "error", code: "invalid_output" }]);
    });

    it("重复 / 矛盾的 crisis 标记：无效输出", async () => {
      const dup = JSON.stringify({ crisis: false, ...body }).replace(/}$/, ',"crisis":true}');
      const { events } = await collect(streamed(dup, 5));
      expect(events.some((e) => e.type === "result")).toBe(false);
      expect(events.at(-1)).toEqual({ type: "error", code: "invalid_output" });
    });

    it("流中 crisis:false 但 done 文本 crisis:true：危机优先，不产生结果", async () => {
      const steps: Step[] = [
        ...streamed(withCrisis(false, "first"), 5).slice(0, -1),
        { type: "done", text: withCrisis(true, "first"), stopReason: "end" },
      ];
      const { events } = await collect(steps);
      expect(events.at(-1)).toEqual({ type: "crisis" });
      expect(events.some((e) => e.type === "result")).toBe(false);
    });
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

describe("crisis 首字段约定（只降低首章节延迟；安全保证来自服务端缓冲）", () => {
  it("schema 的第一个属性是 crisis", () => {
    expect(Object.keys(READING_JSON_SCHEMA.properties)[0]).toBe("crisis");
    expect(Object.keys(REWRITE_JSON_SCHEMA.properties)[0]).toBe("crisis");
    expect(Object.keys(PERSPECTIVE_JSON_SCHEMA.properties)[0]).toBe("crisis");
    expect(READING_JSON_SCHEMA.required[0]).toBe("crisis");
  });

  it("prompt 要求 crisis 为第一个字段且是布尔值", () => {
    for (const prompt of [readingSystemPrompt(), rewriteSystemPrompt(), perspectiveSystemPrompt()]) {
      expect(prompt).toMatch(/crisis：必须是 JSON 对象里(\*\*)?第一个(\*\*)?字段/);
      expect(prompt).toContain("布尔");
    }
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

  it("缺失或类型错误的 crisis 标记视为无效输出", async () => {
    for (const text of ['{"question":"面对裁员的担心，我能先做些什么？"}', '{"crisis":"false","question":"面对裁员的担心，我能先做些什么？"}']) {
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

describe("runPerspective（换个视角）", () => {
  const previous = buildLocalReading(request).interpretations;
  const goodBody = {
    crisis: false,
    overall: "换个角度看：你已经在认真对待这件事，这本身值得被看见。",
    interpretations: ["也许这份疲惫在提醒你，需要的不只是答案，还有休息。", "如果把三张牌当作三个问题，哪一个你最想先回答？"],
    question: "如果不用立刻决定，你最想先弄清楚什么？",
  };
  const run = (steps: Step[], tone: "support" | "rational" | "challenge" = "support", signal?: AbortSignal) => {
    const provider = mockProvider(steps);
    return runPerspective(request, tone, previous, provider, signal).then((outcome) => ({ outcome, provider }));
  };
  const done = (value: unknown, stopReason: "end" | "max_tokens" = "end"): Step[] => [{ type: "done", text: JSON.stringify(value), stopReason }];

  it("通过校验：返回视角正文与版本（deep 模型、prompt v3），请求里带着视角与已给过的读法", async () => {
    const { outcome, provider } = await run(done(goodBody), "rational");
    expect(outcome).toMatchObject({ type: "ok", versions: { prompt: "v3", model: "mock-model" } });
    expect(provider.calls[0].tier).toBe("deep");
    expect(provider.calls[0].prompt).toContain("rational");
    expect(provider.calls[0].prompt).toContain(previous[0]);
    expect(provider.calls[0].prompt).toContain("cardId: the-tower | position: 0 | reversed: false");
  });

  it("输出里不含 action：多出来的 action 字段被拒绝，原小行动不可能被覆盖", async () => {
    const { outcome } = await run(done({ ...goodBody, action: "今晚就去辞职" }));
    expect(outcome).toEqual({ type: "error", code: "invalid_output" });
  });

  it("crisis 为 true → 危机；缺失 / 类型错误 → 无效；截断 → 无效", async () => {
    expect((await run(done({ ...goodBody, crisis: true }))).outcome).toEqual({ type: "crisis" });
    const { crisis: _c, ...noCrisis } = goodBody;
    void _c;
    expect((await run(done(noCrisis))).outcome).toEqual({ type: "error", code: "invalid_output" });
    expect((await run(done({ ...goodBody, crisis: "false" }))).outcome).toEqual({ type: "error", code: "invalid_output" });
    expect((await run(done(goodBody, "max_tokens"))).outcome).toEqual({ type: "error", code: "invalid_output" });
  });

  it("拒绝：断言式用语、两个读法相同、原样重复上次的读法、非问句收尾", async () => {
    for (const bad of [
      { ...goodBody, overall: "你注定会离开这份工作。" },
      { ...goodBody, interpretations: [goodBody.interpretations[0], goodBody.interpretations[0]] },
      { ...goodBody, interpretations: [previous[0], goodBody.interpretations[1]] },
      { ...goodBody, question: "你该休息了。" },
    ]) {
      expect((await run(done(bad))).outcome).toEqual({ type: "error", code: "invalid_output" });
    }
  });

  it("拒答 / 错误映射 / 已取消不启动 provider", async () => {
    expect((await run([{ type: "refusal" }])).outcome).toEqual({ type: "refusal" });
    expect((await run([{ type: "throw", kind: "overloaded" }])).outcome).toEqual({ type: "error", code: "overloaded" });
    const controller = new AbortController();
    controller.abort();
    const { outcome, provider } = await run(done(goodBody), "support", controller.signal);
    expect(outcome).toEqual({ type: "error", code: "cancelled" });
    expect(provider.calls).toHaveLength(0);
  });

  it("用户消息不含 action 的要求之外的个人字段泄漏：只含问题、自解、牌面", () => {
    const prompt = perspectiveUserPrompt(request, "challenge", previous);
    expect(prompt).toContain(request.question);
    expect(prompt).toContain("challenge");
  });
});
