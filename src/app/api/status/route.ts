import { connection } from "next/server";
import { getProvider } from "@/lib/ai/server";
import { guardApiRequest } from "@/lib/http/guard";

/** 前端据此决定是否显示 AI 选项。只返回布尔值，不暴露 key。 */
export async function GET(request: Request) {
  const denied = guardApiRequest(request, { json: false });
  if (denied) return denied;
  await connection();
  return Response.json({ ai: getProvider() !== null });
}
