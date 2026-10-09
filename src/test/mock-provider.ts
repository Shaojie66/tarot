// 测试用 provider：按脚本吐出事件，或在指定位置抛错，模拟各种失败。

import { AIError, type AIErrorKind, type AIProvider, type GenerateEvent, type GenerateRequest } from "@/lib/ai/provider";

export type Step = GenerateEvent | { type: "throw"; kind: AIErrorKind } | { type: "hang" };

export function mockProvider(steps: Step[] | ((req: GenerateRequest) => Step[])): AIProvider & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];
  return {
    calls,
    model: () => "mock-model",
    async *stream(req) {
      calls.push(req);
      for (const step of typeof steps === "function" ? steps(req) : steps) {
        if (req.signal?.aborted) throw new AIError("aborted");
        if (step.type === "throw") throw new AIError(step.kind);
        if (step.type === "hang") {
          await new Promise<void>((_, reject) => req.signal?.addEventListener("abort", () => reject(new AIError("aborted"))));
          continue;
        }
        yield step;
      }
    },
  };
}

/** 把一段 JSON 文本切成若干 text 事件 + done，模拟流式输出。 */
export function streamed(json: string, chunk = 17): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < json.length; i += chunk) steps.push({ type: "text", delta: json.slice(i, i + chunk) });
  steps.push({ type: "done", text: json, stopReason: "end" });
  return steps;
}

/** 把一个 ReadingResult 变成模型应输出的 JSON 字段（去掉 source，加 crisis）。 */
export function modelBody<T extends { source: unknown }>(result: T): Omit<T, "source"> {
  const body: Partial<T> = { ...result };
  delete body.source;
  return body as Omit<T, "source">;
}
