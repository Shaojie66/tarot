// 占卜流程状态机（纯函数，客户端用 useReducer 驱动）。
// 关键约束：牌一旦固定就不再重抽；迟到的生成结果按 requestId 丢弃；记录只创建一次。

import type { Topic } from "@/features/cards/schema";
import type { DrawnCard } from "@/features/draw/draw";
import type { ReadingErrorCode, Versions } from "./ai";
import type { ReadingBody, ReadingChoice, ReadingResult } from "./contract";

export type Stage = "topic" | "question" | "rewrite" | "draw" | "self" | "reading" | "result" | "crisis";

export type GenerationStatus = "idle" | "generating" | "done" | "refused" | "failed" | "cancelled";

export interface Generation {
  status: GenerationStatus;
  source: "ai" | "local" | null;
  requestId: number;
  error: ReadingErrorCode | null;
  /** 已校验的章节（受控流式），完成前仅作预览 */
  sections: Partial<ReadingBody>;
}

/** 本次占卜是否允许把内容发送给模型 API。在提交问题时明确选择；null 只出现在旧版草稿，按本地处理。 */
export type Mode = "local" | "ai";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export interface FlowState {
  stage: Stage;
  topic: Topic | null;
  mode: Mode | null;
  originalQuestion: string;
  question: string;
  /** AI 改写建议；null 表示没有建议 */
  suggestion: string | null;
  cards: DrawnCard[] | null;
  /** 已翻开的牌数 */
  revealed: number;
  selfReading: string;
  generation: Generation;
  result: ReadingResult | null;
  versions: Versions | null;
  choice: ReadingChoice;
  recordId: string | null;
  createdAt: string | null;
  saveStatus: SaveStatus;
  /** 手动重试保存时递增，触发同一记录 ID 的再次写入 */
  saveNonce: number;
}

export const initialChoice: ReadingChoice = {
  interpretation: null,
  rejected: [],
  action: { status: "undecided", text: "" },
};

export const initialFlow: FlowState = {
  stage: "topic",
  topic: null,
  mode: null,
  originalQuestion: "",
  question: "",
  suggestion: null,
  cards: null,
  revealed: 0,
  selfReading: "",
  generation: { status: "idle", source: null, requestId: 0, error: null, sections: {} },
  result: null,
  versions: null,
  choice: initialChoice,
  recordId: null,
  createdAt: null,
  saveStatus: "idle",
  saveNonce: 0,
};

export type FlowAction =
  | { type: "chooseTopic"; topic: Topic }
  | { type: "submitQuestion"; question: string; mode: Mode }
  | { type: "setMode"; mode: Mode }
  | { type: "rewriteSuggested"; suggestion: string }
  | { type: "rewriteSkipped" }
  | { type: "confirmQuestion"; question: string }
  | { type: "drawn"; cards: DrawnCard[] }
  | { type: "reveal"; count: number }
  | { type: "submitSelf"; selfReading: string }
  | { type: "startGeneration"; source: "ai" | "local"; requestId: number }
  | { type: "section"; requestId: number; key: keyof ReadingBody; value: unknown }
  | { type: "generated"; requestId: number; result: ReadingResult; versions: Versions; recordId: string; createdAt: string }
  | { type: "refused"; requestId: number }
  | { type: "failed"; requestId: number; error: ReadingErrorCode }
  | { type: "cancel" }
  /** requestId：来自异步流的危机事件必须带上，迟到的旧请求事件不能中止新会话 */
  | { type: "crisis"; question?: string; requestId?: number }
  | { type: "editAfterCrisis" }
  | { type: "chooseInterpretation"; index: 0 | 1 | null }
  | { type: "toggleRejected"; index: 0 | 1 }
  | { type: "setAction"; status: ReadingChoice["action"]["status"]; text: string }
  | { type: "saving" }
  | { type: "saved" }
  | { type: "saveFailed" }
  | { type: "retrySave" }
  | { type: "back" }
  | { type: "restore"; state: FlowState }
  | { type: "reset" };

function isCurrent(state: FlowState, requestId: number): boolean {
  return state.generation.status === "generating" && state.generation.requestId === requestId;
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "chooseTopic":
      return { ...state, topic: action.topic, stage: "question" };
    case "submitQuestion":
      return {
        ...state,
        originalQuestion: action.question,
        question: action.question,
        suggestion: null,
        mode: action.mode,
        stage: action.mode === "ai" ? "rewrite" : "draw",
      };
    case "setMode":
      return { ...state, mode: action.mode };
    case "rewriteSuggested":
      return state.stage === "rewrite" ? { ...state, suggestion: action.suggestion } : state;
    case "rewriteSkipped":
      return state.stage === "rewrite" ? { ...state, suggestion: null, stage: "draw" } : state;
    case "confirmQuestion":
      return state.stage === "rewrite" ? { ...state, question: action.question, stage: "draw" } : state;
    case "drawn":
      // 牌已固定则忽略：重试、刷新、重复点击都不重抽
      return state.cards ? state : { ...state, cards: action.cards, revealed: 0 };
    case "reveal": {
      if (!state.cards) return state;
      const revealed = Math.min(state.cards.length, Math.max(state.revealed, action.count));
      return { ...state, revealed, stage: revealed === state.cards.length ? "self" : state.stage };
    }
    case "submitSelf":
      return state.stage === "self" ? { ...state, selfReading: action.selfReading, stage: "reading" } : state;
    case "startGeneration":
      if (!state.cards || state.generation.status === "generating" || state.result) return state;
      return {
        ...state,
        stage: "reading",
        generation: { status: "generating", source: action.source, requestId: action.requestId, error: null, sections: {} },
      };
    case "section":
      if (!isCurrent(state, action.requestId)) return state;
      return {
        ...state,
        generation: { ...state.generation, sections: { ...state.generation.sections, [action.key]: action.value } },
      };
    case "generated":
      if (!isCurrent(state, action.requestId) || state.result) return state;
      return {
        ...state,
        stage: "result",
        result: action.result,
        versions: action.versions,
        generation: { ...state.generation, status: "done", sections: {} },
        choice: initialChoice,
        recordId: state.recordId ?? action.recordId,
        createdAt: state.createdAt ?? action.createdAt,
      };
    case "refused":
      return isCurrent(state, action.requestId)
        ? { ...state, generation: { ...state.generation, status: "refused", sections: {} } }
        : state;
    case "failed":
      return isCurrent(state, action.requestId)
        ? { ...state, generation: { ...state.generation, status: "failed", error: action.error, sections: {} } }
        : state;
    case "cancel":
      return state.generation.status === "generating"
        ? { ...state, generation: { ...state.generation, status: "cancelled", sections: {} } }
        : state;
    case "crisis":
      if (action.requestId !== undefined && !isCurrent(state, action.requestId)) return state;
      // 中止占卜：丢弃牌、结果与生成状态，只保留用户写下的文字，供误判时"返回修改"。不产生记录。
      return {
        ...initialFlow,
        stage: "crisis",
        topic: state.topic,
        mode: state.mode,
        originalQuestion: action.question ?? state.originalQuestion,
        selfReading: state.selfReading,
      };
    case "editAfterCrisis":
      // 不提供绕过分流的"继续占卜"：回到起问页，原文保留，改完重新走安全检查
      return state.stage === "crisis"
        ? { ...initialFlow, stage: state.topic ? "question" : "topic", topic: state.topic, mode: state.mode, originalQuestion: state.originalQuestion, selfReading: state.selfReading }
        : state;
    case "chooseInterpretation":
      return { ...state, choice: { ...state.choice, interpretation: action.index } };
    case "toggleRejected": {
      const rejected = state.choice.rejected.includes(action.index)
        ? state.choice.rejected.filter((i) => i !== action.index)
        : [...state.choice.rejected, action.index];
      const interpretation = rejected.includes(state.choice.interpretation as 0 | 1) ? null : state.choice.interpretation;
      return { ...state, choice: { ...state.choice, rejected, interpretation } };
    }
    case "setAction":
      return { ...state, choice: { ...state.choice, action: { status: action.status, text: action.text } } };
    case "saving":
      return { ...state, saveStatus: "saving" };
    case "saved":
      return { ...state, saveStatus: "saved" };
    case "saveFailed":
      return { ...state, saveStatus: "failed" };
    case "retrySave":
      return state.result ? { ...state, saveStatus: "idle", saveNonce: state.saveNonce + 1 } : state;
    case "back":
      if (state.stage === "question") return { ...state, stage: "topic" };
      if (state.stage === "rewrite") return { ...state, stage: "question", suggestion: null };
      return state;
    case "restore":
      return restoreFlow(action.state);
    case "reset":
      return initialFlow;
  }
}

/** 刷新恢复：生成中的请求已经随页面中断，标记为可重试。 */
export function restoreFlow(saved: FlowState): FlowState {
  const generation =
    saved.generation.status === "generating"
      ? { ...saved.generation, status: "cancelled" as const, sections: {} }
      : saved.generation;
  const stage = saved.stage === "rewrite" ? "draw" : saved.stage;
  return { ...saved, mode: saved.mode ?? "local", stage, suggestion: null, generation, saveStatus: saved.saveStatus === "saving" ? "idle" : saved.saveStatus };
}
