// 生成盲看样本文档（冻结的 v2.1 基线 vs 当前候选；基线见 evals/local-quality/baseline-v2.1.json，不再对 v1）：PRINT_LOCAL_SAMPLES=1 pnpm vitest run evals/print-local-samples.test.ts
// 平时跳过。输出 docs/local-reading-samples-*.md（版本顺序按样本 id 打乱）和对应的 key 文件。

import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { getCard } from "@/features/cards/cards";
import { readingRequestSchema } from "@/features/reading/contract";
import { LOCAL_V2, buildLocalReading } from "@/features/reading/local";
import baseline from "./local-quality/baseline-v2.1.json";
import data from "./local-quality/cases.json";

const show = (r: ReturnType<typeof buildLocalReading>) =>
  [`**整体**：${r.overall}`, "", ...r.cards.map((c) => `- ${getCard(c.cardId as never).nameZh}${c.reversed ? "（逆位）" : ""}：${c.text}`), "", `**读法一**：${r.interpretations[0]}`, "", `**读法二**：${r.interpretations[1]}`, "", `**行动**：${r.action}`, "", `**问句**：${r.question}`].join("\n");
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

describe.skipIf(!process.env.PRINT_LOCAL_SAMPLES)("print local samples", () => {
  it("写入 docs/", () => {
    const body: string[] = [];
    const key: string[] = [];
    for (const [i, s] of data.samples.entries()) {
      const req = readingRequestSchema.parse({ spreadId: "three-card", topic: s.topic, originalQuestion: s.question, question: s.question, selfReading: "", intent: s.intent, cards: s.cards });
      const oldR = baseline.samples.find((b) => b.id === s.id)!.output as ReturnType<typeof buildLocalReading>;
      const newR = buildLocalReading(req);
      const swap = hash(s.id) % 2 === 1;
      const [a, b] = swap ? [newR, oldR] : [oldR, newR];
      const cards = s.cards.map((c) => `${getCard(c.cardId as never).nameZh}${c.reversed ? "（逆）" : ""}`).join(" / ");
      body.push(`## 样本 ${i + 1}｜${s.topicless ? "此刻（无具体问题）" : s.topic}｜意图 ${s.intent}\n\n牌：${cards}\n\n### 版本 1\n\n${show(a)}\n\n### 版本 2\n\n${show(b)}\n\n评分与偏好（填写）：偏好 □1 □2 □平；观点 / 三牌 / 主题 / 行动 / 语言 各 0–2：\n`);
      key.push(`| ${i + 1} | ${s.id} | 版本 1 = ${swap ? "候选" : "v2.1"}，版本 2 = ${swap ? "v2.1" : "候选"} |`);
    }
    writeFileSync(`docs/local-reading-samples-${LOCAL_V2.version}-vs-v2.1.md`, `# 本地解读样本：冻结的 v2.1 vs 候选（盲看）\n\n> 16 个冻结样本（\`evals/local-quality/cases.json\`）。每例两个版本，顺序已打乱；**评分前不要看** \`local-reading-samples-key-${LOCAL_V2.version}-vs-v2.1.md\`。\n> 按 PRD 的 0–2 分逐项评分（观点明确、三牌关联、主题匹配、行动具体、语言直接），并选更偏好的版本。建议至少 12/16 偏好候选版（平局不算）。\n> 样本只用 12 张已写好内容的样稿牌；其余牌仍走 v1 模板。**评分时请注明评审人和人数；AI 预审不能当人工通过。**\n\n${body.join("\n---\n\n")}`);
    writeFileSync(`docs/local-reading-samples-key-${LOCAL_V2.version}-vs-v2.1.md`, `# 盲看对照表（评分后再看）\n\n| # | 样本 | 版本对应 |\n|---|---|---|\n${key.join("\n")}\n`);
  });
});
