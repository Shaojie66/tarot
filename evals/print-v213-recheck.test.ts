// V213_RECHECK=1（第二轮）/ V213_RECHECK=r3（第三轮：模板层修改后复评例 4、A、B 加 3 个新例）pnpm vitest run evals/print-v213-recheck.test.ts
// AI 代审第二轮：只列待审的审读组，加上抽检未过线的例 4（重新渲染）和同一阻碍牌的另外两个组合。写入 tmp/。
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import table from "./local-quality/v213-mode-table.json";
import heldout from "../docs/local-reading-expansion/batch-0-heldout.json";
import { buildLocalReading, selectFallbackLens } from "@/features/reading/local";
import { getCard } from "@/features/cards/cards";
import { TOPIC_LABELS } from "@/features/cards/schema";
import { INTENT_LABELS } from "@/features/profile/intent";
import { corpus, requestOf, specOf } from "./local-quality/v211-corpus";

it.skipIf(!["1", "r3"].includes(process.env.V213_RECHECK ?? ""))("prepare AI recheck", () => {
  const groups = table.groups as Record<string, { reviewed: string | null; aiReviewed?: string | null }>;
  const pending = Object.keys(groups).filter((k) => groups[k].reviewed === null && !groups[k].aiReviewed);
  const md = readFileSync("docs/local-reading-expansion/v213-review-groups.md", "utf8").split(/\n(?=## )/);
  const sections = md.filter((s) => pending.some((k) => s.startsWith(`## ${k}\n`)));
  const render = (spec: string) => {
    const req = requestOf(spec), r = buildLocalReading(req);
    return [`${TOPIC_LABELS[req.topic]}｜${INTENT_LABELS[req.intent!]}｜${req.cards.map((c, j) => `${["此刻", "阻碍", "下一步"][j]} ${getCard(c.cardId as never).nameZh}${c.reversed ? "（逆位）" : ""}`).join(" / ")}`, `<!-- spec: ${spec} -->`, "", `**整体**：${r.overall}`, "", ...r.cards.map((c, j) => `- ${["此刻", "阻碍", "下一步"][j]}：${c.text}`), "", `**读法一**：${r.interpretations[0]}`, "", `**读法二**：${r.interpretations[1]}`, "", `**行动**：${r.action}`, "", `**追问**：${r.question}`, ""].join("\n");
  };
  const ex4 = "career|decide|eight-of-wands,two-of-pentacles,six-of-swords:r";
  const h = (s: string) => createHash("sha256").update(`recheck|${s}`).digest("hex");
  const others = [...corpus("career", "decide"), ...corpus("self", "decide")].filter((r) => r.cards[1].cardId === "two-of-pentacles" && !r.cards[1].reversed && selectFallbackLens(r) === "v2.13" && specOf(r) !== ex4).map(specOf).sort((a, b) => h(a).localeCompare(h(b))).slice(0, 2);
  const r3 = process.env.V213_RECHECK === "r3";
  // 第三轮：从 heldout9 的理清 / 决定基础组合里，取抽检没用过的 3 个
  const spot = readFileSync("docs/local-reading-expansion/v213-human-spotcheck.md", "utf8");
  const fresh = (heldout.heldout9 as string[]).filter((x) => x.split("|")[1] !== "companion" && !spot.includes(x)).sort((a, b) => h(a).localeCompare(h(b))).slice(0, 3);
  if (r3) {
    const out3 = ["# AI 代审第三轮（模板层修改后）", "", `## 一、待重审的审读组（${sections.length} 组）`, "", ...sections, "", "## 二、抽检复评", "", "### 例 4", "", render(ex4), "### 同牌组合 A", "", render(others[0]), "### 同牌组合 B", "", render(others[1]), ...fresh.flatMap((x, i) => [`### 新例 ${i + 1}`, "", render(x)])];
    writeFileSync("tmp/v213-ai-recheck-r3.md", out3.join("\n"));
    console.log("RECHECK3", sections.length, fresh.join(" ; "));
    return;
  }
  const out = ["# AI 代审第二轮", "", `## 一、待重审的审读组（${sections.length} 组）`, "", ...sections, "", "## 二、抽检复评（例 4 修改后，及同一阻碍牌的另两个组合）", "", "### 例 4（修改后）", "", render(ex4), "### 同牌组合 A", "", render(others[0]), "### 同牌组合 B", "", render(others[1])];
  writeFileSync("tmp/v213-ai-recheck.md", out.join("\n"));
  console.log("RECHECK", sections.length, others.join(" ; "));
});
