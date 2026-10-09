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

  it("restores an interrupted generation as retryable", () => {
    const generating = run(ready, { type: "startGeneration", source: "ai", requestId: 1 });
    const restored = restoreFlow(JSON.parse(JSON.stringify(generating)));
    expect(restored.generation.status).toBe("cancelled");
    expect(restored.cards).toEqual(cards);
  });
});
