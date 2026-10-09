// 浏览器端调用 /api/*。网络错误统一映射成 ReadingErrorCode，不把细节暴露给用户。

import type { Topic } from "@/features/cards/schema";
import type { ReadingStreamEvent, RewriteOutcome } from "./ai";
import type { ReadingRequest } from "./contract";

export async function fetchAiStatus(): Promise<boolean> {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    return res.ok && ((await res.json()) as { ai?: boolean }).ai === true;
  } catch {
    return false;
  }
}

export async function requestRewrite(question: string, topic: Topic, signal: AbortSignal): Promise<RewriteOutcome> {
  try {
    const res = await fetch("/api/rewrite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, topic }),
      signal,
    });
    return (await res.json()) as RewriteOutcome;
  } catch {
    return { type: "error", code: signal.aborted ? "cancelled" : "network" };
  }
}

/** 逐行读取 NDJSON 事件。断流（没有收到终止事件）时补一个 network 错误。 */
export async function* streamReading(request: ReadingRequest, signal: AbortSignal): AsyncGenerator<ReadingStreamEvent> {
  let res: Response;
  try {
    res = await fetch("/api/reading", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    yield { type: "error", code: signal.aborted ? "cancelled" : "network" };
    return;
  }
  if (!res.ok || !res.body) {
    yield { type: "error", code: "unknown" };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let terminal = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line) as ReadingStreamEvent;
        if (event.type !== "section") terminal = true;
        yield event;
      }
    }
  } catch {
    if (!terminal) yield { type: "error", code: signal.aborted ? "cancelled" : "network" };
    return;
  }
  if (!terminal) yield { type: "error", code: "network" };
}
