// 流的整体 / 无进展期限。SDK 的 timeout 只覆盖到响应头返回，之后流挂起不会超时，所以在 provider 外层再包一层。
// 超时 → 中止上游请求（signal）并抛 AIError("timeout")；调用方主动取消 → 原样抛 aborted。

import { AIError, type AIProvider, type GenerateEvent, type GenerateRequest } from "./provider";

export interface DeadlineOptions {
  /** 整个流的最长时间 */
  totalMs: number;
  /** 两次事件之间的最长静默 */
  idleMs: number;
}

const TIMED_OUT = Symbol("timed-out");

export function withDeadline(inner: AIProvider, options: DeadlineOptions): AIProvider {
  return {
    model: inner.model,
    async *stream(request: GenerateRequest): AsyncGenerator<GenerateEvent> {
      const upstream = new AbortController();
      const forward = () => upstream.abort();
      if (request.signal?.aborted) throw new AIError("aborted");
      request.signal?.addEventListener("abort", forward);
      const iterator = inner.stream({ ...request, signal: upstream.signal })[Symbol.asyncIterator]();
      const startedAt = Date.now();
      let finished = false;
      try {
        for (;;) {
          const budget = Math.min(options.idleMs, options.totalMs - (Date.now() - startedAt));
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
            timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, budget));
          });
          const next = await Promise.race([iterator.next(), timeout]).finally(() => clearTimeout(timer));
          if (next === TIMED_OUT) {
            upstream.abort();
            throw new AIError("timeout");
          }
          if (next.done) {
            finished = true;
            return;
          }
          yield next.value;
        }
      } finally {
        request.signal?.removeEventListener("abort", forward);
        if (!finished) {
          upstream.abort();
          // 不等待：挂起的上游在 abort 后自行结束
          void Promise.resolve(iterator.return?.()).catch(() => {});
        }
      }
    },
  };
}
