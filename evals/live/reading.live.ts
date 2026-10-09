// 真实模型评测：40 个固定解读用例 + 危机集（AI 层）。
// 结果写入 tmp/evals/（已 gitignore），供人工按 README 的分项打分。
// 硬检查（结构、牌面一致、文案红线）通过率要求 ≥ 90%；AI 层危机标记只报告，本地规则是第一道防线。

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runAiReading, runRewrite, type ReadingStreamEvent } from "@/features/reading/ai";
import { readingRequestSchema } from "@/features/reading/contract";
import { getProvider } from "@/lib/ai/server";
import cases from "../reading/cases.json";
import safety from "../safety/cases.json";

const provider = getProvider();
const outDir = fileURLToPath(new URL("../../tmp/evals/", import.meta.url));

describe.skipIf(!provider)("live model eval", () => {
  it("reading cases pass hard checks", async () => {
    const rows = [];
    for (const c of cases.cases) {
      const request = readingRequestSchema.parse({
        spreadId: "three-card",
        topic: c.topic,
        originalQuestion: c.question,
        question: c.question,
        selfReading: c.selfReading,
        cards: c.cards,
      });
      const started = Date.now();
      let last: ReadingStreamEvent | undefined;
      let firstSectionMs: number | null = null;
      for await (const event of runAiReading(request, provider!)) {
        if (event.type === "section" && firstSectionMs === null) firstSectionMs = Date.now() - started;
        last = event;
      }
      rows.push({ id: c.id, ok: last?.type === "result", outcome: last, firstSectionMs, totalMs: Date.now() - started });
    }
    const passRate = rows.filter((r) => r.ok).length / rows.length;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}reading-live-${Date.now()}.json`, JSON.stringify({ passRate, rows }, null, 2));
    console.log(`hard-check pass rate: ${(passRate * 100).toFixed(1)}%`);
    expect(passRate).toBeGreaterThanOrEqual(0.9);
  });

  it("reports the AI-layer crisis flag rate", async () => {
    let caught = 0;
    let falseAlarms = 0;
    for (const text of safety.crisis) if ((await runRewrite(text, "self", provider!)).type === "crisis") caught++;
    for (const text of safety.safe) if ((await runRewrite(text, "self", provider!)).type === "crisis") falseAlarms++;
    console.log(`AI layer: caught ${caught}/${safety.crisis.length}, false alarms ${falseAlarms}/${safety.safe.length}`);
  });
});
