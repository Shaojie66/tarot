import { z } from "zod";
import { runPerspective } from "@/features/reading/ai";
import { TONES, checkRequest, readingRequestSchema } from "@/features/reading/contract";
import { detectCrisis } from "@/features/safety/crisis";
import { getProvider } from "@/lib/ai/server";
import { guardApiRequest } from "@/lib/http/guard";
import { readJsonBody } from "@/lib/http/json-body";

const bodySchema = z.strictObject({
  request: readingRequestSchema,
  tone: z.enum(TONES),
  /** 已经给过的读法（要求这次不同）。可为空。 */
  previous: z.array(z.string().max(600)).max(8).default([]),
});

export async function POST(request: Request) {
  const denied = guardApiRequest(request, { json: true });
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success || checkRequest(parsed.data.request)) {
    return Response.json({ type: "error", code: "bad_request" }, { status: 400 });
  }
  const { request: reading, tone, previous } = parsed.data;
  // 安全检查：和解读一样，先过本地规则，命中就不进模型
  if (detectCrisis(reading.originalQuestion, reading.question, reading.selfReading).flagged) {
    return Response.json({ type: "crisis" });
  }
  const provider = getProvider();
  if (!provider) return Response.json({ type: "error", code: "unavailable" }, { status: 503 });
  return Response.json(await runPerspective(reading, tone, previous, provider, request.signal));
}
