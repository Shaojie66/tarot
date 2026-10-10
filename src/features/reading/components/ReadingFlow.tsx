"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { TOPICS, TOPIC_LABELS, type Topic } from "@/features/cards/schema";
import { drawCards } from "@/features/draw/draw";
import { useSettings } from "@/features/settings/settings";
import { CrisisSupport } from "@/features/safety/CrisisSupport";
import { detectCrisis } from "@/features/safety/crisis";
import { randomId } from "@/lib/id";
import type { ReadingErrorCode } from "../ai";
import { fetchAiStatus, requestRewrite, streamReading } from "../client";
import {
  CONTENT_VERSION,
  QUESTION_MAX,
  RECORD_SCHEMA_VERSION,
  SELF_READING_MAX,
  type ReadingBody,
  type ReadingRequest,
} from "../contract";
import { flowReducer, initialFlow, type FlowState, type Mode } from "../flow";
import { buildLocalReading } from "../local";
import { QUESTION_BANK } from "../questions";
import { orderScenarios, type ScenarioId } from "../scenarios";
import { DEFAULT_SPREAD, getSpread } from "../spread";
import { clearSession, getDraftWritable, loadSession, saveFlowRecord, storeSession, subscribeDraftHealth } from "../storage";
import { ProfileOnboarding } from "@/features/profile/ProfileOnboarding";
import { INTENTS, INTENT_LABELS, type Intent } from "@/features/profile/intent";
import { useProfile } from "@/features/profile/profile";
import { addRecall } from "@/features/recall/recall";
import { RecordRecallPanel } from "@/features/recall/RecordRecallPanel";
import { useRecordRecall } from "@/features/recall/useRecordRecall";
import { DrawTable } from "./DrawTable";
import { ResultView } from "./ResultView";

const SPREAD_ID = DEFAULT_SPREAD;
const spread = getSpread(SPREAD_ID);

const ERROR_TEXT: Record<ReadingErrorCode, string> = {
  auth: "API key 无效或没有权限。检查 .env.local 里的 key 配置，或者先用本地解读。",
  rate_limit: "请求太频繁了，稍等一会儿再试。",
  timeout: "模型响应超时了。",
  network: "连接中断了，解读没有完整返回。",
  overloaded: "模型服务暂时繁忙。",
  invalid_output: "这次生成的结果不完整或不合格，已丢弃。",
  unavailable: "没有配置 API key，AI 解读不可用。",
  cancelled: "已取消。",
  bad_request: "请求格式不被接受，这次没有发出。刷新页面后再试，或先用本地解读。",
  protocol: "服务返回的数据格式不对，已丢弃。可以重试，或改用本地解读。",
  forbidden: "请求被本机服务拒绝：请用 localhost 打开页面，或按 README 显式开启局域网访问。",
  unknown: "出了点问题，解读没有完成。",
};

function toRequest(state: FlowState): ReadingRequest | null {
  if (!state.topic || !state.cards) return null;
  return {
    spreadId: SPREAD_ID,
    topic: state.topic,
    originalQuestion: state.originalQuestion,
    question: state.question,
    selfReading: state.selfReading,
    ...(state.intent ? { intent: state.intent } : {}),
    cards: state.cards,
  };
}

export function ReadingFlow() {
  const router = useRouter();
  const [state, dispatch] = useReducer(flowReducer, initialFlow);
  const settings = useSettings();
  const profile = useProfile();
  const [hydrated, setHydrated] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const requestSeq = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  /** 同步防重：state 来不及更新时的第二次点击也只会发出一个请求 */
  const busyRequest = useRef<number | null>(null);
  /** 已处理过“要不要自动安排回读”的记录：新记录首次保存时只判断一次；恢复出来的旧结果不补发 */
  const recallHandled = useRef<Set<string>>(new Set());
  /** 默认节奏只在新记录首次保存那一刻取值，之后改默认不影响它 */
  const cadenceRef = useRef(profile.recallCadence);
  useEffect(() => {
    cadenceRef.current = profile.recallCadence;
  }, [profile.recallCadence]);
  /** 自动安排回读失败的记录 id：记录已保存，提醒没保存 */
  const [recallFailedFor, setRecallFailedFor] = useState<string | null>(null);
  /** 仅本次的意图：undefined = 沿用偏好；在抽牌那一刻固定进请求与记录 */
  const [intentOverride, setIntentOverride] = useState<Intent | undefined>(undefined);

  // 离开页面 / 组件卸载：中止进行中的解读请求
  useEffect(
    () => () => {
      inflight.current?.abort();
      inflight.current = null;
    },
    [],
  );

  // 恢复上次的流程
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = loadSession();
      if (loaded) {
        const { state: saved } = loaded;
        // 草稿里的选择是用户最近一次的操作，数据库写入可能还没落地（点完立刻刷新），所以以草稿为准；
        // 恢复后下面的保存 effect 会把它写回同一条记录。旧版草稿的默认选择已在迁移时降为“未决定”。
        const restored = saved;
        if (restored.recordId) recallHandled.current.add(restored.recordId);
        if (!cancelled) dispatch({ type: "restore", state: restored });
      }
      if (!cancelled) setHydrated(true);
    })();
    fetchAiStatus().then((ok) => !cancelled && setAiAvailable(ok));
    return () => {
      cancelled = true;
    };
  }, []);

  const draftUnsaved = !useSyncExternalStore(subscribeDraftHealth, getDraftWritable, () => true);
  useEffect(() => {
    if (hydrated) storeSession(state);
  }, [hydrated, state]);

  // 结果与用户选择变化时写入同一条记录
  const { result, choice, recordId, createdAt, versions, saveNonce } = state;
  useEffect(() => {
    const request = toRequest(state);
    if (!hydrated || !result || !recordId || !createdAt || !request) return;
    let stale = false;
    dispatch({ type: "saving" });
    saveFlowRecord({
      id: recordId,
      schemaVersion: RECORD_SCHEMA_VERSION,
      deckId: state.deckId,
      settings: { allowReversed: state.allowReversed },
      createdAt,
      request,
      result,
      choice,
      versions: versions ?? { content: CONTENT_VERSION, prompt: null, model: null },
    })
      .then(() => {
        if (!stale) dispatch({ type: "saved" });
        // 正式记录保存成功后，才按当时的默认节奏为这条新记录安排一次“回来看看当时的自己”
        if (!recallHandled.current.has(recordId)) {
          recallHandled.current.add(recordId);
          const cadenceDays = cadenceRef.current === "3days" ? 3 : cadenceRef.current === "7days" ? 7 : null;
          if (cadenceDays !== null && !addRecall(recordId, cadenceDays)) setRecallFailedFor(recordId);
        }
      })
      .catch(() => !stale && dispatch({ type: "saveFailed" }));
    return () => {
      stale = true;
    };
    // state 的其余字段在结果生成后不再变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, result, choice, recordId, createdAt, versions, saveNonce]);

  // 问题改写（有 key 时）。失败不阻塞流程，直接用原问题。
  useEffect(() => {
    if (state.stage !== "rewrite" || state.suggestion !== null || !state.topic) return;
    const controller = new AbortController();
    requestRewrite(state.question, state.topic, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.type === "crisis") dispatch({ type: "crisis" });
      else if (outcome.type === "ok" && outcome.question !== state.question) {
        dispatch({ type: "rewriteSuggested", suggestion: outcome.question });
      } else dispatch({ type: "rewriteSkipped" });
    });
    return () => controller.abort();
  }, [state.stage, state.suggestion, state.question, state.topic]);

  const restart = useCallback(() => {
    inflight.current?.abort();
    inflight.current = null;
    busyRequest.current = null;
    clearSession();
    setIntentOverride(undefined);
    dispatch({ type: "reset" });
  }, []);

  const generate = useCallback(
    async (source: "ai" | "local") => {
      const request = toRequest(state);
      if (!request || state.generation.status === "generating" || busyRequest.current !== null) return;
      // 安全检查②：确认后的问题 + 自解
      if (detectCrisis(request.originalQuestion, request.question, request.selfReading).flagged) {
        dispatch({ type: "crisis" });
        return;
      }
      const requestId = ++requestSeq.current;
      busyRequest.current = requestId;
      dispatch({ type: "startGeneration", source, requestId });
      const meta = { recordId: randomId(), createdAt: new Date().toISOString() };

      if (source === "local") {
        dispatch({
          type: "generated",
          requestId,
          result: buildLocalReading(request),
          versions: { content: CONTENT_VERSION, prompt: null, model: null },
          ...meta,
        });
        busyRequest.current = null;
        return;
      }

      const controller = new AbortController();
      inflight.current = controller;
      for await (const event of streamReading(request, controller.signal)) {
        if (event.type === "section") dispatch({ type: "section", requestId, key: event.key, value: event.value });
        else if (event.type === "result") dispatch({ type: "generated", requestId, result: event.result, versions: event.versions, ...meta });
        else if (event.type === "crisis") dispatch({ type: "crisis", requestId });
        else if (event.type === "refusal") dispatch({ type: "refused", requestId });
        else dispatch({ type: "failed", requestId, error: event.code });
      }
      if (inflight.current === controller) inflight.current = null;
      if (busyRequest.current === requestId) busyRequest.current = null;
    },
    [state],
  );

  /** 抽牌：只在客户端 crypto 完成；同时固定这一次用的牌组与正逆位设置。 */
  function drawAction() {
    const allowReversed = spread.allowReversed && settings.allowReversed;
    return {
      type: "drawn" as const,
      cards: drawCards({ count: spread.positions.length, allowReversed }),
      deckId: settings.deckId,
      allowReversed,
      // 优先用户“仅本次”的选择；“此刻”卡没有具体问题，默认陪伴语气；其余按偏好里的意图（没选就是中性默认）
      intent: intentOverride ?? (state.scenario === "topicless" ? ("companion" as const) : profile.intent),
    };
  }

  function cancel() {
    inflight.current?.abort();
    inflight.current = null;
    busyRequest.current = null;
    dispatch({ type: "cancel" });
  }

  if (!hydrated) return <p className="py-16 text-center text-sm text-muted">正在准备牌桌…</p>;

  if (state.stage === "crisis") {
    return <CrisisSupport onEdit={() => dispatch({ type: "editAfterCrisis" })} onExit={() => { restart(); router.push("/"); }} />;
  }

  return (
    <div className="space-y-8">
      {draftUnsaved && state.stage !== "scenario" && (
        <p role="status" className="rounded-lg bg-surface px-4 py-2 text-xs leading-relaxed text-muted" data-testid="draft-unsaved">
          这个浏览器没有允许保存进行中的进度（可能是隐私模式或存储已满）。现在刷新页面会丢失当前这一步。
        </p>
      )}
      {state.stage === "scenario" && (
        <ScenarioGate>
          <ScenarioStep
            onChoose={(scenario) => dispatch({ type: "chooseScenario", scenario })}
            onWriteOwn={() => dispatch({ type: "writeOwn" })}
          />
        </ScenarioGate>
      )}

      {state.stage === "topic" && <TopicStep onChoose={(topic) => dispatch({ type: "chooseTopic", topic })} />}

      {state.stage === "question" && state.topic && (
        <QuestionStep
          topic={state.topic}
          initial={state.originalQuestion}
          onBack={() => dispatch({ type: "back" })}
          aiAvailable={aiAvailable}
          onSubmit={(question, mode) => {
            // 安全检查①：问题进入任何后续步骤之前
            if (detectCrisis(question).flagged) dispatch({ type: "crisis", question });
            else dispatch({ type: "submitQuestion", question, mode });
          }}
        />
      )}

      {state.stage === "rewrite" && (
        <RewriteStep
          original={state.question}
          suggestion={state.suggestion}
          onConfirm={(question) => dispatch({ type: "confirmQuestion", question })}
          onSkip={() => dispatch({ type: "rewriteSkipped" })}
        />
      )}

      {state.cards || state.stage === "draw" ? (
        <section aria-label="抽牌" className="space-y-4">
          <QuestionBanner topic={state.topic} question={state.question} />
          {!state.cards && (
            <IntentLine
              value={intentOverride ?? (state.scenario === "topicless" ? "companion" : profile.intent)}
              inherited={intentOverride === undefined}
              onChange={setIntentOverride}
            />
          )}
          <DrawTable
            spread={spread}
            deck={state.cards ? state.deckId : settings.deckId}
            cards={state.cards}
            revealed={state.revealed}
            onShuffled={() => dispatch(drawAction())}
            onReveal={(count) => dispatch({ type: "reveal", count })}
            onQuickDraw={() => {
              dispatch(drawAction());
              dispatch({ type: "reveal", count: spread.positions.length });
            }}
          />
        </section>
      ) : null}

      {state.stage === "self" && <SelfStep initial={state.selfReading} onSubmit={(text) => dispatch({ type: "submitSelf", selfReading: text })} />}

      {state.stage === "reading" && (
        <GenerateStep
          aiAvailable={aiAvailable}
          mode={state.mode}
          status={state.generation.status}
          source={state.generation.source}
          error={state.generation.error}
          sections={state.generation.sections}
          intent={state.intent}
          onGenerate={generate}
          onCancel={cancel}
        />
      )}

      {state.stage === "result" && state.result && (
        <ResultView
          spread={spread}
          result={state.result}
          choice={state.choice}
          saveStatus={state.saveStatus}
          recordId={state.recordId}
          onRetrySave={() => dispatch({ type: "retrySave" })}
          onChoose={(index) => dispatch({ type: "chooseInterpretation", index })}
          onToggleRejected={(index) => dispatch({ type: "toggleRejected", index })}
          onAction={(status, text) => dispatch({ type: "setAction", status, text })}
          onRestart={restart}
        />
      )}

      {state.stage === "result" && state.result && state.saveStatus === "saved" && state.recordId && (
        <SavedRecall recordId={state.recordId} failedAutoSchedule={recallFailedFor === state.recordId} />
      )}

      {state.stage !== "topic" && state.stage !== "result" && (
        <button type="button" onClick={restart} className="inline-flex min-h-11 items-center text-xs text-muted underline underline-offset-4">
          从头开始
        </button>
      )}
    </div>
  );
}

/** 建档引导：未建档时排在情境卡下面（可跳过），不挡住主操作、不阻塞占卜。建档完成 / 跳过后 profile.onboarded 变 true，自然消失。 */
function ScenarioGate({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  return (
    <div className="space-y-12">
      {children}
      {!profile.onboarded && <ProfileOnboarding onDone={() => {}} onSkip={() => {}} />}
    </div>
  );
}

function ScenarioStep({ onChoose, onWriteOwn }: { onChoose: (scenario: ScenarioId) => void; onWriteOwn: () => void }) {
  const profile = useProfile();
  return (
    <section aria-labelledby="scenario-title" className="space-y-5">
      <h2 id="scenario-title" className="diary-title">
        这一刻，想看看什么？
      </h2>
      <p className="text-sm leading-relaxed text-muted">选一张卡，直接开始。不用想太多，牌是随机抽的。</p>
      <div className="hairline">
        {orderScenarios(profile.topics).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChoose(s.id)}
            className="group flex min-h-16 w-full items-baseline justify-between gap-4 border-b border-line py-4 text-left transition-colors hover:border-accent"
          >
            <span className="font-serif text-xl">{s.question}</span>
            <span className="text-xs text-muted group-hover:text-ink" aria-hidden>
              →
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onWriteOwn}
        className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-4 hover:text-ink"
      >
        自己写一个问题
      </button>
    </section>
  );
}

function TopicStep({ onChoose }: { onChoose: (topic: Topic) => void }) {
  return (
    <section aria-labelledby="topic-title" className="space-y-5">
      <h2 id="topic-title" className="diary-title">
        最近在想哪方面的事？
      </h2>
      <div className="hairline">
        {TOPICS.map((topic) => (
          <button
            key={topic}
            type="button"
            onClick={() => onChoose(topic)}
            className="group flex min-h-16 w-full items-baseline justify-between gap-4 border-b border-line py-4 text-left transition-colors hover:border-accent"
          >
            <span className="font-serif text-xl">{TOPIC_LABELS[topic]}</span>
            <span className="text-xs leading-relaxed text-muted group-hover:text-ink">{QUESTION_BANK.topics[topic].hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function QuestionStep({
  topic,
  initial,
  aiAvailable,
  onSubmit,
  onBack,
}: {
  topic: Topic;
  initial: string;
  aiAvailable: boolean | null;
  onSubmit: (question: string, mode: Mode) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState(initial);
  const [unsure, setUnsure] = useState(false);
  const examples = unsure ? QUESTION_BANK.unsure.prompts : QUESTION_BANK.topics[topic].examples;
  const question = text.trim();
  return (
    <section aria-labelledby="question-title" className="space-y-5">
      <button type="button" onClick={onBack} className="text-sm text-muted hover:text-ink">
        ← {TOPIC_LABELS[topic]}
      </button>
      <h2 id="question-title" className="diary-title">
        想问自己什么？
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // 有 key 时必须由下面两个按钮明确选择；回车提交只在无 key 时有效
          if (question && aiAvailable === false) onSubmit(question, "local");
        }}
        className="space-y-3"
      >
        <label htmlFor="question" className="sr-only">
          你的问题
        </label>
        <textarea
          id="question"
          value={text}
          maxLength={QUESTION_MAX}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          placeholder="用自己的话写，比如：我在这份工作里到底想要什么？"
          className="diary field w-full resize-none rounded-none border-0 border-b border-line bg-transparent px-0 py-3 placeholder:text-muted/70"
        />
        {aiAvailable ? (
          <>
            <p className="text-xs leading-relaxed text-muted">
              选一种方式继续。<b>全程本地</b>：不调用模型，问题只留在你的浏览器里。<b>AI 辅助</b>：问题会发送给模型 API 做改写；之后解读时还会发送自解、牌面和这次想要的帮助（你的偏好或抽牌前的选择），服务端不保存。
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={!question} onClick={() => onSubmit(question, "local")} className="rounded-full bg-accent px-5 py-2 text-bg disabled:opacity-40">
                全程本地，不发送
              </button>
              <button type="button" disabled={!question} onClick={() => onSubmit(question, "ai")} className="rounded-full border border-line px-5 py-2 disabled:opacity-40">
                AI 辅助（会发送问题）
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted">问题只保存在你的浏览器里。</p>
            <button type="submit" disabled={!question || aiAvailable === null} className="rounded-full bg-accent px-6 py-2 text-bg disabled:opacity-40">
              就问这个
            </button>
          </>
        )}
      </form>
      <div className="space-y-2">
        <p className="text-sm text-muted">{unsure ? "可以从这些开始：" : "或者选一个："}</p>
        <ul className="space-y-2">
          {examples.map((q) => (
            <li key={q}>
              <button type="button" onClick={() => setText(q)} className="text-left text-sm leading-relaxed hover:text-accent">
                {q}
              </button>
            </li>
          ))}
        </ul>
        {!unsure && (
          <button type="button" onClick={() => setUnsure(true)} className="text-sm text-accent underline underline-offset-4">
            {QUESTION_BANK.unsure.label}
          </button>
        )}
      </div>
    </section>
  );
}

function RewriteStep({
  original,
  suggestion,
  onConfirm,
  onSkip,
}: {
  original: string;
  suggestion: string | null;
  onConfirm: (question: string) => void;
  onSkip: () => void;
}) {
  const [edited, setEdited] = useState<string | null>(null);
  if (suggestion === null) {
    return (
      <section className="space-y-3 text-center" aria-live="polite">
        <p className="text-sm text-muted">正在帮你把问题整理成一个可以反思的问法…</p>
        <button type="button" onClick={onSkip} className="text-sm underline underline-offset-4">
          跳过，直接抽牌
        </button>
      </section>
    );
  }
  const value = edited ?? suggestion;
  return (
    <section aria-labelledby="rewrite-title" className="space-y-4">
      <h2 id="rewrite-title" className="diary-title !text-2xl">
        换个问法试试？
      </h2>
      <p className="text-sm text-muted">你的原话：{original}</p>
      <label htmlFor="rewrite" className="sr-only">
        改写后的问题
      </label>
      <textarea
        id="rewrite"
        value={value}
        rows={2}
        maxLength={QUESTION_MAX}
        onChange={(e) => setEdited(e.target.value)}
        className="diary field w-full resize-none rounded-none border-0 border-b border-accent/60 bg-transparent px-0 py-3"
      />
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!value.trim()} onClick={() => onConfirm(value.trim())} className="rounded-full bg-accent px-5 py-2 text-bg disabled:opacity-40">
          用这个问法
        </button>
        <button type="button" onClick={() => onConfirm(original)} className="rounded-full border border-line px-5 py-2">
          保留我的原话
        </button>
      </div>
    </section>
  );
}

function QuestionBanner({ topic, question }: { topic: Topic | null; question: string }) {
  if (!question) return null;
  return (
    <div className="hairline pt-4">
      {topic && <p className="eyebrow">{TOPIC_LABELS[topic]}</p>}
      <p className="mt-1 font-serif text-lg leading-relaxed">{question}</p>
    </div>
  );
}

function SelfStep({ initial, onSubmit }: { initial: string; onSubmit: (text: string) => void }) {
  const [text, setText] = useState(initial);
  return (
    <form
      aria-labelledby="self-title"
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(text.trim());
      }}
    >
      <h2 id="self-title" className="diary-title !text-2xl">
        你第一眼看到了什么？
      </h2>
      <p className="text-sm text-muted">一个词、一种感觉都可以。你的第一反应比牌义更重要。</p>
      <label htmlFor="self" className="sr-only">
        你的第一反应
      </label>
      <input
        id="self"
        value={text}
        maxLength={SELF_READING_MAX}
        onChange={(e) => setText(e.target.value)}
        placeholder="比如：中间那张让我有点不舒服"
        className="diary field w-full rounded-none border-0 border-b border-line bg-transparent px-0 py-3"
      />
      <div className="flex gap-3">
        <button type="submit" className="rounded-full bg-accent px-5 py-2 text-bg">
          {text.trim() ? "继续" : "跳过"}
        </button>
      </div>
    </form>
  );
}

const SECTION_ORDER: (keyof ReadingBody)[] = ["overall", "interpretations", "action", "question"];

function GenerateStep({
  aiAvailable,
  mode,
  status,
  source,
  error,
  sections,
  intent,
  onGenerate,
  onCancel,
}: {
  aiAvailable: boolean | null;
  mode: Mode | null;
  status: FlowState["generation"]["status"];
  source: "ai" | "local" | null;
  error: ReadingErrorCode | null;
  sections: Partial<ReadingBody>;
  intent: Intent | null;
  onGenerate: (source: "ai" | "local") => void;
  onCancel: () => void;
}) {
  if (status === "generating") {
    return (
      <section aria-live="polite" className="space-y-4">
        <p className="text-sm text-muted">正在解读…（生成中的内容尚未完成校验）</p>
        <div className="space-y-3 text-ink/80">
          {SECTION_ORDER.map((key) => {
            const value = sections[key];
            if (value === undefined) return null;
            const text = Array.isArray(value) ? value.join(" / ") : String(value);
            return <p key={key} className="leading-relaxed">{text}</p>;
          })}
        </div>
        <button type="button" onClick={onCancel} className="rounded-full border border-line px-4 py-1.5 text-sm">
          取消
        </button>
      </section>
    );
  }

  const failed = status === "failed" || status === "refused" || status === "cancelled";
  const showAi = aiAvailable === true && status !== "refused" && error !== "auth";
  const aiPrimary = showAi && mode === "ai";
  return (
    <section aria-labelledby="generate-title" className="space-y-4">
      <h2 id="generate-title" className="font-serif text-xl">
        {failed ? "解读没有完成" : "准备好了，看看这三张牌怎么说"}
      </h2>
      {status === "refused" && <p role="alert" className="text-sm leading-relaxed">这次 AI 没有给出解读。你的牌和问题都还在，可以改用本地解读。</p>}
      {(status === "failed" || status === "cancelled") && error !== null && (
        <p role="alert" className="text-sm leading-relaxed">
          {ERROR_TEXT[error]} 你的问题、自解和牌都保留着，不会重抽。
        </p>
      )}
      {status === "cancelled" && error === null && <p className="text-sm">已取消。你的问题、自解和牌都保留着，不会重抽。</p>}
      <div className="flex flex-wrap gap-3">
        {showAi && (
          <button
            type="button"
            onClick={() => onGenerate("ai")}
            className={aiPrimary ? "rounded-full bg-accent px-5 py-2 text-bg" : "rounded-full border border-line px-5 py-2"}
          >
            {failed && source === "ai" ? "重试 AI 解读" : aiPrimary ? "AI 解读" : "改用 AI 解读"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onGenerate("local")}
          className={aiPrimary ? "rounded-full border border-line px-5 py-2" : "rounded-full bg-accent px-5 py-2 text-bg"}
        >
          {failed && source === "ai" ? "改用本地解读" : "本地解读"}
        </button>
      </div>
      <p className="text-xs text-muted">
        {aiAvailable === false && "没有配置 API key：本地解读用牌义和规则模板组织，不联网调用模型。"}
        {showAi && `AI 解读会把问题、自解和牌面发送给模型 API${intent ? `，同时附上这次想要的帮助（${INTENT_LABELS[intent]}）` : ""}；本地解读不发送任何内容。`}
        {showAi && mode === "ai" && " 问题改写阶段已经发送过问题；这一步选本地解读不会再发送内容。"}
      </p>
    </section>
  );
}

/** 抽牌前显示这次想要的帮助；默认沿用偏好，“仅本次调整”只影响这一次，抽牌时固定。 */
function IntentLine({ value, inherited, onChange }: { value: Intent | null; inherited: boolean; onChange: (intent: Intent | undefined) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 text-sm">
      <label htmlFor="intent-once" className="text-muted">
        这次想要的帮助{inherited ? "（沿用你的偏好）" : "（仅本次）"}
      </label>
      <select
        id="intent-once"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : (e.target.value as Intent))}
        className="min-h-11 rounded-none border-0 border-b border-line bg-transparent py-1"
      >
        {value === null && <option value="">未选（中性默认）</option>}
        {INTENTS.map((it) => (
          <option key={it} value={it}>
            {INTENT_LABELS[it]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 记录保存成功之后的回看安排：如实显示已安排的时间，可调整或取消；自动安排失败时明说。 */
function SavedRecall({ recordId, failedAutoSchedule }: { recordId: string; failedAutoSchedule: boolean }) {
  const recall = useRecordRecall(recordId);
  return (
    <section aria-label="回看提醒" className="hairline space-y-2 pt-5" data-testid="saved-recall">
      {failedAutoSchedule && recall === null && (
        <p role="alert" className="text-sm leading-relaxed">
          记录已保存，回看提醒没能保存。可以在下面重新安排。
        </p>
      )}
      <RecordRecallPanel recordId={recordId} recall={recall} variant="saved" />
    </section>
  );
}
