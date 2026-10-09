import { runAiReading, type ReadingStreamEvent } from "@/features/reading/ai";
import { checkRequest, readingRequestSchema } from "@/features/reading/contract";
import { detectCrisis } from "@/features/safety/crisis";
import { getProvider } from "@/lib/ai/server";
import { readJsonBody } from "@/lib/http/json-body";

/** NDJSON：每行一个 ReadingStreamEvent。只推送已校验的章节和最终结果。 */
function ndjson(events: AsyncIterable<ReadingStreamEvent> | ReadingStreamEvent[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const parsed = readingRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success || checkRequest(parsed.data)) {
    return Response.json({ type: "error", code: "bad_request" }, { status: 400 });
  }
  const reading = parsed.data;
  // 安全检查②：确认后的问题 + 自解
  if (detectCrisis(reading.originalQuestion, reading.question, reading.selfReading).flagged) {
    return ndjson([{ type: "crisis" }]);
  }
  const provider = getProvider();
  if (!provider) return ndjson([{ type: "error", code: "unavailable" }]);
  return ndjson(runAiReading(reading, provider, request.signal));
}
