"use client";

import { useState } from "react";
import { TOPICS, TOPIC_LABELS, type Topic } from "@/features/cards/schema";
import { INTENTS, INTENT_LABELS, RECALL_CADENCES, RECALL_CADENCE_LABELS, completeOnboarding, skipOnboarding, type Intent, type RecallCadence } from "./profile";

type Step = "intent" | "topics" | "recall";

const ROW = "flex min-h-12 w-full items-center justify-between gap-4 border-b border-line py-3 text-left text-sm transition-colors hover:text-accent";

/**
 * 首访建档：1–3 屏、全选择题、可跳过、存本地、永不二问。排在情境卡下面，不挡住主操作。
 * 选的东西都会用上：意图决定解读语气，主题偏好决定情境卡的排序，回读节奏决定保存后是否安排回看。
 * 之后都可以在“设置”里改。
 */
export function ProfileOnboarding({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [step, setStep] = useState<Step>("intent");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);

  return (
    <section aria-labelledby="onboarding-title" className="hairline space-y-5 pt-8">
      <header className="space-y-2">
        <h2 id="onboarding-title" className="font-serif text-xl">
          {step === "intent" ? "先花几秒定个方向" : step === "topics" ? "你常为哪类事来？" : "抽完想不想回来看一眼？"}
        </h2>
        <p className="text-xs leading-relaxed text-muted">只问这一次，之后不再打扰你。偏好保存在这个浏览器里，之后可以在“设置”里改；选择 AI 解读时，这次想要的帮助也会发给你配置的模型。</p>
      </header>

      {step === "intent" && (
        <>
          <p className="text-sm text-muted">通常更希望从这里获得什么帮助？</p>
          <div className="hairline">
            {INTENTS.map((it) => (
              <button
                key={it}
                type="button"
                onClick={() => {
                  setIntent(it);
                  setStep("topics");
                }}
                className={ROW}
              >
                <span>{INTENT_LABELS[it]}</span>
                <span aria-hidden>→</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setStep("topics")} className="flex min-h-11 items-center text-sm text-muted underline underline-offset-4">
            先不选，下一步
          </button>
        </>
      )}

      {step === "topics" && (
        <>
          <fieldset>
            <legend className="sr-only">主题偏好（可多选）</legend>
            <p className="pb-2 text-sm text-muted">选了的主题，会排在前面。先不选也行。</p>
            <div className="hairline">
              {TOPICS.map((t) => {
                const active = topics.includes(t);
                return (
                  <label key={t} className={`${ROW} cursor-pointer ${active ? "text-accent" : ""}`}>
                    <span>{TOPIC_LABELS[t]}</span>
                    <input
                      type="checkbox"
                      checked={active}
                      aria-label={`偏好 ${TOPIC_LABELS[t]}`}
                      onChange={() => setTopics((cur) => (active ? cur.filter((x) => x !== t) : cur.length >= 4 ? cur : [...cur, t]))}
                      className="h-6 w-6 shrink-0"
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => {
                completeOnboarding({ intent, topics });
                onDone();
              }}
              className="min-h-11 rounded-full bg-accent px-6 text-bg"
            >
              就这些，开始
            </button>
            <button type="button" onClick={() => setStep("recall")} className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-4">
              下一步
            </button>
          </div>
        </>
      )}

      {step === "recall" && (
        <>
          <div className="hairline">
            {RECALL_CADENCES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  completeOnboarding({ intent, topics, recallCadence: c as RecallCadence });
                  onDone();
                }}
                className={ROW}
              >
                <span>{RECALL_CADENCE_LABELS[c]}</span>
                <span aria-hidden>→</span>
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted">选一个，保存之后会在那天轻轻提醒你回来看看当时的自己；不选就不提醒。提醒只在这个页面里出现，不会推送。</p>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          skipOnboarding();
          onSkip();
        }}
        className="flex min-h-11 items-center text-sm text-muted underline underline-offset-4 hover:text-ink"
      >
        全部跳过，直接开始
      </button>
    </section>
  );
}
