// 浏览器端调用 /api/*。网络错误统一映射成 ReadingErrorCode，不把细节暴露给用户。

import type { Topic } from "@/features/cards/schema";
import type { ReadingErrorCode, ReadingStreamEvent, RewriteOutcome } from "./ai";
import type { ReadingRequest } from "./contract";

export async function fetchAiStatus(): Promise<boolean> {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    return res.ok && ((await res.json()) as { ai?: boolean }).ai === true;
  } catch {
    return false;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<ReadingErrorCode>([
  "auth", "rate_limit", "timeout", "network", "overloaded", "invalid_output", "unavailable", "cancelled", "forbidden", "bad_request", "protocol", "unknown",
]);

/** 非 200 响应：优先用服务端给的错误码，否则按状态码映射。 */
async function codeFromResponse(res: Response): Promise<ReadingErrorCode> {
  try {
    const body = (await res.json()) as { code?: unknown };
    if (typeof body.code === "string" && KNOWN_CODES.has(body.code)) return body.code as ReadingErrorCode;
  } catch {}
  if (res.status === 403) return "forbidden";
  if (res.status === 400 || res.status === 415) return "bad_request";
  if (res.status === 429) return "rate_limit";
  if (res.status === 503) return "unavailable";
  return "unknown";
}

const EVENT_TYPES: ReadonlySet<string> = new Set(["section", "result", "crisis", "refusal", "error"]);

function parseEvent(line: string): ReadingStreamEvent | null {
  try {
    const event = JSON.parse(line) as { type?: unknown };
    return event && typeof event.type === "string" && EVENT_TYPES.has(event.type) ? (event as ReadingStreamEvent) : null;
  } catch {
    return null;
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
    if (!res.ok) return { type: "error", code: await codeFromResponse(res) };
    try {
      return (await res.json()) as RewriteOutcome;
    } catch {
      return { type: "error", code: signal.aborted ? "cancelled" : "protocol" };
    }
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
    yield { type: "error", code: res.ok ? "protocol" : await codeFromResponse(res) };
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
        const event = parseEvent(line);
        if (!event) {
          // 畸形行：协议错误，终止并关闭连接；与网络断流区分
          await reader.cancel().catch(() => {});
          yield { type: "error", code: "protocol" };
          return;
        }
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
