"use client";

import { useEffect, useRef, useState } from "react";
import type { ReadingErrorCode } from "@/features/reading/ai";
import { fetchAiStatus, requestPerspective } from "@/features/reading/client";
import { MAX_PERSPECTIVES, TONES, TONE_LABELS, type Perspective, type ReadingRecord, type Tone } from "@/features/reading/contract";
import { addPerspective } from "@/features/reading/storage";
import { CrisisSupport } from "@/features/safety/CrisisSupport";
import { formatTime } from "@/features/history/labels";
import { randomId } from "@/lib/id";

const TONE_HINT: Record<Tone, string> = {
  support: "先接住当下的感受，再轻轻指出可以看看的地方",
  rational: "把问题拆成几块分别看，不替你下结论",
  challenge: "温和但直接地追问被回避的部分",
};

const ERROR_TEXT: Partial<Record<ReadingErrorCode, string>> = {
  auth: "API key 无效或没有权限。",
  rate_limit: "请求太频繁了，稍等一会儿再试。",
  timeout: "模型响应超时了。",
  network: "连接中断了。",
  overloaded: "模型服务暂时繁忙。",
  invalid_output: "这次生成的结果不合格，已丢弃。",
  unavailable: "没有配置 API key。",
  forbidden: "请求被本机服务拒绝：请用 localhost 打开页面。",
  cancelled: "已取消。",
};

type Status = { state: "idle" } | { state: "working"; tone: Tone } | { state: "failed"; tone: Tone; code: ReadingErrorCode } | { state: "refused"; tone: Tone } | { state: "crisis" };

/**
 * 换个视角。结果作为附加快照存进同一条记录：原解读、原小行动、你的选择都不动。
 * 失败 / 取消 / 危机命中时记录原样不变。同一时刻只会有一个请求在飞。
 */
export function PerspectivePanel({ record, onSaved }: { record: ReadingRecord; onSaved: (record: ReadingRecord) => void }) {
  const [ai, setAi] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchAiStatus().then((ok) => !cancelled && setAi(ok));
    return () => {
      cancelled = true;
      controller.current?.abort();
    };
  }, []);

  const have = new Map((record.perspectives ?? []).map((p) => [p.tone, p]));
  const remaining = TONES.filter((t) => !have.has(t));

  async function generate(tone: Tone) {
    if (busy.current || have.has(tone)) return;
    busy.current = true;
    const ctl = new AbortController();
    controller.current = ctl;
    setStatus({ state: "working", tone });
    try {
      const outcome = await requestPerspective(record.request, tone, [...record.result.interpretations, ...[...have.values()].flatMap((p) => p.body.interpretations)], ctl.signal);
      if (ctl.signal.aborted) return setStatus({ state: "idle" });
      if (outcome.type === "crisis") return setStatus({ state: "crisis" });
      if (outcome.type === "refusal") return setStatus({ state: "refused", tone });
      if (outcome.type === "error") return setStatus({ state: "failed", tone, code: outcome.code });
      const perspective: Perspective = { id: randomId(), tone, createdAt: new Date().toISOString(), source: "ai", versions: outcome.versions, body: outcome.body };
      try {
        onSaved(await addPerspective(record.id, perspective));
        setStatus({ state: "idle" });
      } catch {
        setStatus({ state: "failed", tone, code: "unknown" });
      }
    } finally {
      busy.current = false;
      controller.current = null;
    }
  }

  if (status.state === "crisis") {
    return <CrisisSupport onExit={() => setStatus({ state: "idle" })} exitLabel="返回这条记录" />;
  }

  return (
    <section aria-labelledby="perspective-title" className="space-y-3">
      <h3 id="perspective-title" className="font-serif text-lg">
        换个视角
      </h3>
      <p className="text-xs leading-relaxed text-muted">同样的问题、同样的三张牌，换一种语气再看一遍。结果会另存一份，不会改动上面当时的解读和你的选择。</p>

      {[...have.values()].map((p) => (
        <article key={p.id} className="space-y-2 rounded-lg border border-line p-4" data-testid={`perspective-${p.tone}`}>
          <p className="text-xs text-muted">
            换视角 · {TONE_LABELS[p.tone]} · AI · {formatTime(p.createdAt)}
          </p>
          <p className="leading-relaxed">{p.body.overall}</p>
          {p.body.interpretations.map((t, i) => (
            <p key={i} className="rounded-md bg-surface p-3 text-sm leading-relaxed">
              <span className="mr-2 text-xs text-muted">读法{i === 0 ? "一" : "二"}</span>
              {t}
            </p>
          ))}
          <p className="question-line">{p.body.question}</p>
        </article>
      ))}

      {ai === false && remaining.length > 0 && <p className="text-sm text-muted">换视角需要 AI：本机服务没有配置 API key。</p>}

      {ai && remaining.length > 0 && (
        <>
          <p className="text-xs leading-relaxed text-muted">点下面任一个，会把你的问题、自解、牌面、这次想要的帮助和之前给过的读法发送给模型 API（和“AI 辅助”一样）。</p>
          <div className="flex flex-wrap gap-2">
            {remaining.map((tone) => (
              <button
                key={tone}
                type="button"
                disabled={status.state === "working"}
                onClick={() => void generate(tone)}
                title={TONE_HINT[tone]}
                className="rounded-full border border-line px-4 py-1.5 text-sm disabled:opacity-40"
              >
                {status.state === "working" && status.tone === tone ? `${TONE_LABELS[tone]}生成中…` : TONE_LABELS[tone]}
              </button>
            ))}
            {status.state === "working" && (
              <button type="button" onClick={() => controller.current?.abort()} className="rounded-full border border-line px-4 py-1.5 text-sm text-muted">
                取消
              </button>
            )}
          </div>
        </>
      )}
      {remaining.length === 0 && have.size === MAX_PERSPECTIVES && <p className="text-xs text-muted">三种视角都看过了。</p>}

      {status.state === "failed" && (
        <p role="alert" className="text-sm leading-relaxed" data-testid="perspective-error">
          {TONE_LABELS[status.tone]}没有生成：{ERROR_TEXT[status.code] ?? "出了点问题。"} 原来的解读没有变化，可以重试。
        </p>
      )}
      {status.state === "refused" && (
        <p role="alert" className="text-sm leading-relaxed">
          这次 AI 没有给出这个视角。原来的解读没有变化。
        </p>
      )}
    </section>
  );
}
