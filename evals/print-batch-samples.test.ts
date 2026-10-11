// 生成某一批次的人工评分表：BATCH=1 pnpm vitest run evals/print-batch-samples.test.ts
// 每张新牌与两张已写完的旧牌组合（轮换位置、正逆位、主题、意图），输出到 docs/local-reading-expansion/batch-N-samples.md。
// 没有基线可比（旧牌组合以前是 v1 路径），所以是绝对评分：每例 0–2 分五项，门槛是每例 ≥8/10 且无单项 0。平时跳过。

import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { TOPICS, TOPIC_LABELS } from "@/features/cards/schema";
import { getCard } from "@/features/cards/cards";
import { INTENT_LABELS, INTENTS } from "@/features/profile/intent";
import { readingRequestSchema } from "@/features/reading/contract";
import { LOCAL_V2, buildLocalReading, selectLocalFocus } from "@/features/reading/local";

const batchNo = Number(process.env.BATCH ?? NaN);

describe.skipIf(Number.isNaN(batchNo))("print batch samples", () => {
  it("写入 docs/local-reading-expansion/", () => {
    const plan = JSON.parse(readFileSync("docs/local-reading-expansion/batches.json", "utf8")).batches as { id: number; cards: string[] }[];
    const batch = plan.find((b) => b.id === batchNo);
    if (!batch) throw new Error(`没有批次 ${batchNo}`);
    let earlier = plan.filter((b) => b.id !== batchNo).flatMap((b) => b.cards).filter((id) => id in LOCAL_V2.cards);
    // 批次 0（样稿）没有“旧牌”：用本批自己的牌互相组合
    if (earlier.length < 2) earlier = batch.cards.filter((id) => id in LOCAL_V2.cards);
    if (earlier.length < 3) throw new Error("需要至少三张已写完的牌来做组合");
    const out: string[] = [];
    let k = 0;
    for (const [i, id] of batch.cards.entries()) {
      if (!(id in LOCAL_V2.cards)) continue;
      for (let j = 0; j < 2; j++) {
        const pool = earlier.filter((x) => x !== id);
        const first = (i * 2 + j) % pool.length;
        let second = (i * 5 + j * 3 + 1) % pool.length;
        if (second === first) second = (second + 1) % pool.length;
        const olds = [pool[first], pool[second]];
        const slot = (i + j) % 3; // 新牌放在哪个位置
        const order = [...olds];
        order.splice(slot, 0, id);
        const topic = TOPICS[(i + j) % TOPICS.length];
        const intent = INTENTS[(i * 2 + j) % INTENTS.length];
        const cards = order.map((cardId, position) => ({ cardId, position, reversed: (i + j + position) % 3 === 0 }));
        const request = readingRequestSchema.parse({ spreadId: "three-card", topic, originalQuestion: "（合成）", question: "（合成）", selfReading: "", intent, cards });
        const r = buildLocalReading(request);
        k++;
        const names = cards.map((c) => `${getCard(c.cardId as never).nameZh}${c.reversed ? "（逆）" : ""}`).join(" / ");
        out.push(
          `## 样本 ${k}｜${TOPIC_LABELS[topic]}｜${INTENT_LABELS[intent]}｜新牌：${getCard(id as never).nameZh}（位置 ${slot + 1}）\n\n牌：${names}　主张：${selectLocalFocus(request) ?? "（未命中，按位置路径）"}\n\n**整体**：${r.overall}\n\n${r.cards.map((c) => `- ${getCard(c.cardId as never).nameZh}${c.reversed ? "（逆位）" : ""}：${c.text}`).join("\n")}\n\n**读法一**：${r.interpretations[0]}\n\n**读法二**：${r.interpretations[1]}\n\n**行动**：${r.action}\n\n**问句**：${r.question}\n\n评分（0–2）：观点 □ 三牌 □ 主题 □ 行动 □ 语言 □　合计 __/10　不通过的句子：\n`,
        );
      }
    }
    writeFileSync(
      `docs/local-reading-expansion/batch-${batchNo}-samples.md`,
      `# 批次 ${batchNo} 人工评分表\n\n> 新牌与旧牌组合（轮换位置、正逆位、主题、意图）。评分标准同 PRD：观点明确、三牌关联、主题匹配、行动具体、语言直接，各 0–2 分；**门槛：每例 ≥8/10 且无单项 0**。评审人：____　日期：____　评分后把结果记进 reviews.json。内容版本：${LOCAL_V2.version}。AI 预审不能代替这张表。\n\n${out.join("\n---\n\n")}`,
    );
  });
});
