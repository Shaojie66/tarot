import { describe, expect, it } from "vitest";
import type { DrawnCard } from "@/features/draw/draw";
import { flowReducer, initialFlow, restoreFlow, type FlowAction, type FlowState } from "./flow";
import { buildLocalReading } from "./local";

const cards: DrawnCard[] = [
  { cardId: "the-fool", position: 0, reversed: false },
  { cardId: "death", position: 1, reversed: true },
  { cardId: "the-star", position: 2, reversed: false },
];

const run = (state: FlowState, ...actions: FlowAction[]) => actions.reduce(flowReducer, state);

const ready = run(
  initialFlow,
  { type: "chooseTopic", topic: "self" },
  { type: "submitQuestion", question: "我在回避什么？", mode: "local" },
  { type: "drawn", cards },
  { type: "reveal", count: 3 },
  { type: "submitSelf", selfReading: "" },
);

const result = buildLocalReading({
  spreadId: "three-card",
  topic: "self",
  originalQuestion: "我在回避什么？",
  question: "我在回避什么？",
  selfReading: "",
  cards,
});
const meta = { versions: { content: "c", prompt: null, model: null }, recordId: "rec-00000001", createdAt: new Date(0).toISOString() };

describe("flowReducer", () => {
  it("walks to the reading stage without self-reading", () => {
    expect(ready.stage).toBe("reading");
    expect(ready.selfReading).toBe("");
  });

  it("本地模式跳过改写，AI 模式进入改写；旧草稿无 mode 按本地恢复", () => {
    const local = run(initialFlow, { type: "chooseTopic", topic: "self" }, { type: "submitQuestion", question: "q", mode: "local" });
    expect(local.stage).toBe("draw");
    expect(local.mode).toBe("local");
    const ai = run(initialFlow, { type: "chooseTopic", topic: "self" }, { type: "submitQuestion", question: "q", mode: "ai" });
    expect(ai.stage).toBe("rewrite");
    expect(ai.mode).toBe("ai");
    expect(restoreFlow({ ...ready, mode: undefined } as unknown as FlowState).mode).toBe("local");
  });

  it("抽牌时固定牌组与正逆位设置快照，之后不再变化", () => {
    const drawn = run(
      initialFlow,
      { type: "chooseTopic", topic: "self" },
      { type: "submitQuestion", question: "q", mode: "local" },
      { type: "drawn", cards, deckId: "rws-1909", allowReversed: false },
    );
    expect(drawn.allowReversed).toBe(false);
    expect(drawn.deckId).toBe("rws-1909");
    // 牌已固定：重复的 drawn 不会改快照
    expect(run(drawn, { type: "drawn", cards, allowReversed: true }).allowReversed).toBe(false);
  });

  it("抽牌时固定“这次想要的帮助”，之后不变；旧草稿没有该字段按中性默认", () => {
    const drawn = run(initialFlow, { type: "chooseTopic", topic: "self" }, { type: "submitQuestion", question: "q", mode: "local" }, { type: "drawn", cards, intent: "decide" });
    expect(drawn.intent).toBe("decide");
    expect(run(drawn, { type: "drawn", cards, intent: "companion" }).intent).toBe("decide");
    expect(initialFlow.intent).toBeNull();
  });

  it("never redraws once cards are fixed", () => {
    const other: DrawnCard[] = cards.map((c) => ({ ...c, cardId: "the-sun" as const }));
    expect(run(ready, { type: "drawn", cards: other }).cards).toEqual(cards);
  });

  it("keeps cards on failure and allows retry with a new request", () => {
    const failed = run(ready, { type: "startGeneration", source: "ai", requestId: 1 }, { type: "failed", requestId: 1, error: "timeout" });
    expect(failed.generation.status).toBe("failed");
    expect(failed.cards).toEqual(cards);
    const retried = run(failed, { type: "startGeneration", source: "local", requestId: 2 }, { type: "generated", requestId: 2, result, ...meta });
    expect(retried.stage).toBe("result");
    expect(retried.cards).toEqual(cards);
  });

  it("ignores a duplicate start while generating", () => {
    const s = run(ready, { type: "startGeneration", source: "ai", requestId: 1 }, { type: "startGeneration", source: "ai", requestId: 2 });
    expect(s.generation.requestId).toBe(1);
  });

  it("ignores late results after cancel", () => {
    const s = run(
      ready,
      { type: "startGeneration", source: "ai", requestId: 1 },
      { type: "cancel" },
      { type: "section", requestId: 1, key: "overall", value: "late" },
      { type: "generated", requestId: 1, result, ...meta },
    );
    expect(s.generation.status).toBe("cancelled");
    expect(s.result).toBeNull();
    expect(s.generation.sections).toEqual({});
  });

  it("assigns the record id once", () => {
    const done = run(ready, { type: "startGeneration", source: "local", requestId: 1 }, { type: "generated", requestId: 1, result, ...meta });
    const again = run(done, { type: "startGeneration", source: "local", requestId: 2 }, { type: "generated", requestId: 2, result, ...meta, recordId: "rec-other" });
    expect(again.recordId).toBe("rec-00000001");
  });

  it("lets the user reject a reading and change the action", () => {
    const done = run(ready, { type: "startGeneration", source: "local", requestId: 1 }, { type: "generated", requestId: 1, result, ...meta });
    const s = run(
      done,
      { type: "chooseInterpretation", index: 0 },
      { type: "toggleRejected", index: 0 },
      { type: "setAction", status: "skipped", text: "" },
    );
    expect(s.choice).toEqual({ interpretation: null, rejected: [0], action: { status: "skipped", text: "" } });
  });

  it("drops the draw on crisis", () => {
    const s = run(ready, { type: "crisis" });
    expect(s.stage).toBe("crisis");
    expect(s.cards).toBeNull();
  });

  it("危机分流后可返回修改：丢弃牌与结果，保留用户写的文字，不提供继续占卜", () => {
    const withSelf = run(ready, { type: "submitSelf", selfReading: "x" });
    const crisis = run({ ...ready, selfReading: "看完只想一了百了" }, { type: "crisis" });
    expect(crisis.stage).toBe("crisis");
    expect(crisis.cards).toBeNull();
    expect(crisis.result).toBeNull();
    expect(crisis.originalQuestion).toBe("我在回避什么？");
    expect(crisis.selfReading).toBe("看完只想一了百了");
    expect(withSelf.stage).toBe("reading");

    const back = run(crisis, { type: "editAfterCrisis" });
    expect(back.stage).toBe("question");
    expect(back.topic).toBe("self");
    expect(back.originalQuestion).toBe("我在回避什么？");
    expect(back.selfReading).toBe("看完只想一了百了");
    expect(back.cards).toBeNull();
    expect(back.recordId).toBeNull();
    // 不在危机页时该动作无效
    expect(run(ready, { type: "editAfterCrisis" })).toBe(ready);
  });

  it("起问页提交时命中危机：问题原文随 crisis 动作保留", () => {
    const s = run(initialFlow, { type: "chooseTopic", topic: "self" }, { type: "crisis", question: "我真的不想活了" });
    expect(s.stage).toBe("crisis");
    expect(run(s, { type: "editAfterCrisis" }).originalQuestion).toBe("我真的不想活了");
  });

  it("restores an interrupted generation as retryable", () => {
    const generating = run(ready, { type: "startGeneration", source: "ai", requestId: 1 });
    const restored = restoreFlow(JSON.parse(JSON.stringify(generating)));
    expect(restored.generation.status).toBe("cancelled");
    expect(restored.cards).toEqual(cards);
  });

  it("chooseScenario 快路径：点卡直接进入洗牌，用卡的克制问句作为问题，跳过输入", () => {
    const s = run(initialFlow, { type: "chooseScenario", scenario: "career" });
    expect(s.stage).toBe("draw");
    expect(s.scenario).toBe("career");
    expect(s.topic).toBe("career");
    expect(s.question).toBe("留在原地，还是换个方向？");
    expect(s.originalQuestion).toBe(s.question);
    expect(s.mode).toBe("local");
  });

  it("topicless 情境卡：无题也抽，映射到 self 主题并带 topicless 标记", () => {
    const s = run(initialFlow, { type: "chooseScenario", scenario: "topicless" });
    expect(s.stage).toBe("draw");
    expect(s.scenario).toBe("topicless");
    expect(s.topic).toBe("self");
  });

  it("从 question 页 back 回到情境卡页", () => {
    const atQuestion = run(initialFlow, { type: "chooseTopic", topic: "self" });
    const back = run(atQuestion, { type: "back" });
    expect(back.stage).toBe("scenario");
  });
});
