import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawnCard } from "@/features/draw/draw";
import { DRAFT_VERSION, migrateLegacyDraft, parseDraft } from "./draft";
import { flowReducer, initialFlow, type FlowAction, type FlowState } from "./flow";
import { buildLocalReading } from "./local";
import { clearSession, loadSession, storeSession } from "./storage";

const cards: DrawnCard[] = [
  { cardId: "the-fool", position: 0, reversed: false },
  { cardId: "death", position: 1, reversed: true },
  { cardId: "the-star", position: 2, reversed: false },
];
const run = (state: FlowState, ...actions: FlowAction[]) => actions.reduce(flowReducer, state);
const base = run(
  initialFlow,
  { type: "chooseTopic", topic: "self" },
  { type: "submitQuestion", question: "我在回避什么？", mode: "local" },
  { type: "drawn", cards },
  { type: "reveal", count: 3 },
  { type: "submitSelf", selfReading: "" },
);
const result = buildLocalReading({ spreadId: "three-card", topic: "self", originalQuestion: "q", question: "q", selfReading: "", cards });
const done = run(
  base,
  { type: "startGeneration", source: "local", requestId: 1 },
  { type: "generated", requestId: 1, result, versions: { content: "c", prompt: null, model: null }, recordId: "rec-00000001", createdAt: new Date(0).toISOString() },
);
const wrap = (state: unknown, v: number = DRAFT_VERSION) => JSON.stringify({ v, state });

/** 最小的 localStorage 替身（node 环境没有）。 */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseDraft：合法 JSON 但内容不可信时不崩溃", () => {
  it("接受完整、一致的草稿", () => {
    expect(parseDraft(wrap(done))?.stage).toBe("result");
    expect(parseDraft(wrap(base))?.stage).toBe("reading");
  });

  it.each([
    ["缺字段", wrap({ stage: "question" })],
    ["错版本", wrap(base, 1)],
    ["没有版本包装", JSON.stringify(base)],
    ["非 JSON", "{oops"],
    ["null", "null"],
    ["错阶段", wrap({ ...base, stage: "nope" })],
    ["错牌阵：只有 2 张牌", wrap({ ...base, cards: cards.slice(0, 2) })],
    ["重复牌", wrap({ ...base, cards: [cards[0], cards[0], cards[2]] })],
    ["result 阶段缺结果", wrap({ ...done, result: null })],
    ["结果与抽牌不一致", wrap({ ...done, cards: cards.map((c, i) => (i === 0 ? { ...c, cardId: "the-sun" } : c)) })],
    ["revealed 超出牌数", wrap({ ...base, revealed: 9 })],
    ["generation 缺失", wrap({ ...base, generation: undefined })],
  ])("拒绝：%s", (_name, raw) => {
    expect(parseDraft(raw)).toBeNull();
  });
});

describe("loadSession / storeSession", () => {
  it("往返", () => {
    expect(storeSession(done)).toBe(true);
    expect(loadSession()?.state.recordId).toBe("rec-00000001");
    expect(loadSession()?.legacy).toBe(false);
  });

  it("坏草稿被清掉，且不再触发第二次失败", () => {
    localStorage.setItem("tarot:session:v2", wrap({ stage: "question" }));
    expect(loadSession()).toBeNull();
    expect(localStorage.getItem("tarot:session:v2")).toBeNull();
    expect(loadSession()).toBeNull();
  });

  it("localStorage 写入失败：返回 false，不抛异常", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(storeSession(done)).toBe(false);
  });

  it("localStorage 读取失败（不可用）：返回 null，不抛异常", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(loadSession()).toBeNull();
    clearSession();
  });
});

describe("旧版（v1）草稿", () => {
  const legacyDone = { ...done, choice: { ...done.choice, action: { status: "accepted", text: result.action } } };

  it("迁移后默认 accepted 降为未决定：旧值不冒充用户的明确选择", () => {
    const migrated = migrateLegacyDraft(JSON.stringify(legacyDone));
    expect(migrated?.choice.action).toEqual({ status: "undecided", text: "" });
  });

  it("loadSession 读到旧键时迁移并移除旧键，标记 legacy", () => {
    localStorage.setItem("tarot:session:v1", JSON.stringify(legacyDone));
    const loaded = loadSession();
    expect(loaded?.legacy).toBe(true);
    expect(loaded?.state.choice.action.status).toBe("undecided");
    expect(localStorage.getItem("tarot:session:v1")).toBeNull();
  });

  it("旧版里用户明确编辑 / 跳过的选择保留", () => {
    const edited = { ...done, choice: { ...done.choice, action: { status: "edited", text: "我自己的版本" } } };
    expect(migrateLegacyDraft(JSON.stringify(edited))?.choice.action).toEqual({ status: "edited", text: "我自己的版本" });
  });

  it("旧版里 stage:question 缺字段的坏草稿 → null，不崩溃", () => {
    expect(migrateLegacyDraft(JSON.stringify({ stage: "question" }))).toBeNull();
  });
});

describe("行动默认未决定", () => {
  it("生成结果后行动为 undecided，只有明确操作才改变", () => {
    expect(done.choice.action).toEqual({ status: "undecided", text: "" });
    const accepted = run(done, { type: "setAction", status: "accepted", text: result.action });
    expect(accepted.choice.action.status).toBe("accepted");
  });
});

describe("手动重试保存", () => {
  it("retrySave 递增 nonce、状态回到 idle；记录 ID 不变", () => {
    const failed = run(done, { type: "saveFailed" });
    const retried = run(failed, { type: "retrySave" });
    expect(retried.saveStatus).toBe("idle");
    expect(retried.saveNonce).toBe(failed.saveNonce + 1);
    expect(retried.recordId).toBe(failed.recordId);
  });
});
