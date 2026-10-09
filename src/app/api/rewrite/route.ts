import { z } from "zod";
import { TOPICS } from "@/features/cards/schema";
import { runRewrite } from "@/features/reading/ai";
import { QUESTION_MAX } from "@/features/reading/contract";
import { detectCrisis } from "@/features/safety/crisis";
import { getProvider } from "@/lib/ai/server";
import { guardApiRequest } from "@/lib/http/guard";
import { readJsonBody } from "@/lib/http/json-body";

const bodySchema = z.strictObject({
  question: z.string().trim().min(1).max(QUESTION_MAX),
  topic: z.enum(TOPICS),
});

export async function POST(request: Request) {
  const denied = guardApiRequest(request, { json: true });
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return Response.json({ type: "error", code: "bad_request" }, { status: 400 });
  const { question, topic } = parsed.data;
  // 安全检查①：进入模型之前先过本地规则
  if (detectCrisis(question).flagged) return Response.json({ type: "crisis" });
  const provider = getProvider();
  if (!provider) return Response.json({ type: "error", code: "unavailable" }, { status: 503 });
  return Response.json(await runRewrite(question, topic, provider, request.signal));
}
