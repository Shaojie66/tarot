// API 路由级测试：危机分流在两个入口都先于 provider 执行；被拒请求不会触达上游。

import { afterEach, describe, expect, it, vi } from "vitest";

const getProvider = vi.fn();
vi.mock("@/lib/ai/server", () => ({ getProvider: () => getProvider() }));

import { POST as reading } from "./reading/route";
import { POST as perspective } from "./perspective/route";
import { POST as rewrite } from "./rewrite/route";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
    body: JSON.stringify(body),
  });
}

const cards = [
  { cardId: "the-fool", position: 0, reversed: false },
  { cardId: "death", position: 1, reversed: true },
  { cardId: "the-star", position: 2, reversed: false },
];
const readingBody = (over: object) => ({
  spreadId: "three-card",
  topic: "self",
  originalQuestion: "我在回避什么？",
  question: "我在回避什么？",
  selfReading: "",
  cards,
  ...over,
});

afterEach(() => getProvider.mockReset());

describe("危机分流先于 provider（无需 key 也生效）", () => {
  it("/api/rewrite", async () => {
    const res = await rewrite(post("/api/rewrite", { question: "看完这部电影，我不想活了", topic: "self" }));
    expect(await res.json()).toEqual({ type: "crisis" });
    expect(getProvider).not.toHaveBeenCalled();
  });

  it("/api/reading：问题与自解都检查", async () => {
    for (const over of [{ question: "我真的不想活了", originalQuestion: "我真的不想活了" }, { selfReading: "新闻让我更绝望，我活不下去了" }]) {
      const res = await reading(post("/api/reading", readingBody(over)));
      expect((await res.text()).trim()).toBe('{"type":"crisis"}');
    }
    expect(getProvider).not.toHaveBeenCalled();
  });
});

describe("被拒请求不触达上游 provider", () => {
  it.each([
    ["text/plain", { "content-type": "text/plain" }, 415],
    ["跨站 Origin", { origin: "https://evil.example" }, 403],
    ["非回环 Host", { host: "192.168.1.20:3000" }, 403],
  ])("%s", async (_name, headers, status) => {
    for (const [route, path, body] of [
      [rewrite, "/api/rewrite", { question: "我在回避什么？", topic: "self" }],
      [reading, "/api/reading", readingBody({})],
    ] as const) {
      const res = await route(post(path, body, headers));
      expect(res.status).toBe(status);
    }
    expect(getProvider).not.toHaveBeenCalled();
  });
});

describe("/api/perspective", () => {
  it("危机分流先于 provider；被拒请求不触达上游；无 key 返回 503 unavailable", async () => {
    const crisis = await perspective(post("/api/perspective", { request: readingBody({ selfReading: "活不下去了" }), tone: "support" }));
    expect(await crisis.json()).toEqual({ type: "crisis" });

    for (const headers of [{ "content-type": "text/plain" }, { origin: "https://evil.example" }, { host: "192.168.1.20:3000" }] as Record<string, string>[]) {
      const res = await perspective(post("/api/perspective", { request: readingBody({}), tone: "support" }, headers));
      expect([403, 415]).toContain(res.status);
    }
    expect(getProvider).not.toHaveBeenCalled();

    getProvider.mockReturnValue(null);
    const none = await perspective(post("/api/perspective", { request: readingBody({}), tone: "support" }));
    expect(none.status).toBe(503);
  });

  it("参数不合法 → 400（未知语气、多余字段、牌数不对）", async () => {
    for (const body of [{ request: readingBody({}), tone: "angry" }, { request: readingBody({}), tone: "support", extra: 1 }, { request: readingBody({ cards: cards.slice(0, 2) }), tone: "support" }]) {
      expect((await perspective(post("/api/perspective", body))).status).toBe(400);
    }
  });
});
