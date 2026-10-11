// 渲染任意三牌组合的本地解读（只读工具，平时跳过）：
//   COMBOS='career|clarify|the-hermit:r,death,the-tower;self|companion|…' OUT=tmp/out.md pnpm vitest run evals/print-combos.test.ts
//   COMBOS_FILE=docs/local-reading-expansion/batch-0-heldout.json COMBOS_KEY=heldout OUT=tmp/heldout.md pnpm vitest run evals/print-combos.test.ts
// 牌 id 后加 :r 表示逆位。用途：复评“修订前留出的同牌其他组合”（PROCESS §3.5）、排查某个组合的输出。必须给 OUT（写到 tmp/ 下）。

import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { TOPIC_LABELS, type Topic } from "@/features/cards/schema";
import { getCard } from "@/features/cards/cards";
import { INTENT_LABELS, type Intent } from "@/features/profile/intent";
import { readingRequestSchema } from "@/features/reading/contract";
import { LOCAL_V2, buildLocalReading, selectLocalFocus } from "@/features/reading/local";

const specs: string[] = process.env.COMBOS_FILE
  ? (JSON.parse(readFileSync(process.env.COMBOS_FILE, "utf8"))[process.env.COMBOS_KEY ?? "heldout"] as string[])
  : (process.env.COMBOS ?? "").split(";").map((s) => s.trim()).filter(Boolean);

describe.skipIf(specs.length === 0 || !process.env.OUT)("print combos", () => {
  it("写入 OUT", () => {
    const blocks = specs.map((spec, n) => {
      const [topic, intent, list] = spec.split("|") as [Topic, Intent, string];
      const cards = list.split(",").map((c, position) => ({ cardId: c.replace(/:r$/, ""), position, reversed: c.endsWith(":r") }));
      const request = readingRequestSchema.parse({ spreadId: "three-card", topic, originalQuestion: "（合成）", question: "（合成）", selfReading: "", intent, cards });
      const r = buildLocalReading(request);
      const names = cards.map((c) => `${getCard(c.cardId as never).nameZh}${c.reversed ? "（逆）" : ""}`).join(" / ");
      return `## 组合 ${n + 1}｜${TOPIC_LABELS[topic]}｜${INTENT_LABELS[intent]}\n\n牌：${names}　（${spec}）　主张：${selectLocalFocus(request) ?? "（未命中，按位置路径）"}\n\n**整体**：${r.overall}\n\n${r.cards.map((c) => `- ${getCard(c.cardId as never).nameZh}${c.reversed ? "（逆位）" : ""}：${c.text}`).join("\n")}\n\n**读法一**：${r.interpretations[0]}\n\n**读法二**：${r.interpretations[1]}\n\n**行动**：${r.action}\n\n**问句**：${r.question}\n`;
    });
    writeFileSync(process.env.OUT!, `内容版本：${LOCAL_V2.version}\n\n${blocks.join("\n---\n\n")}`);
  });
});
