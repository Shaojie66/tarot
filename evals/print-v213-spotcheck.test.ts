// V213_SPOT=1 pnpm vitest run evals/print-v213-spotcheck.test.ts
// 为用户的 6 例人工抽检生成材料：heldout9 基础组合中陪伴 / 决定 / 理清各取 2 例（按固定种子排序），用当前引擎渲染。结论由用户填写，AI 不代填。
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import heldout from "../docs/local-reading-expansion/batch-0-heldout.json";
import { buildLocalReading } from "@/features/reading/local";
import { getCard } from "@/features/cards/cards";
import { TOPIC_LABELS } from "@/features/cards/schema";
import { INTENT_LABELS } from "@/features/profile/intent";
import { requestOf } from "./local-quality/v211-corpus";

it.skipIf(process.env.V213_SPOT !== "1")("prepare 6-case human spot check", () => {
  const out = "docs/local-reading-expansion/v213-human-spotcheck.md";
  expect(existsSync(out), "不覆盖已有抽检材料").toBe(false);
  const h = (s: string) => createHash("sha256").update(`v213-spot|${s}`).digest("hex");
  const pick = (intent: string) => (heldout.heldout9 as string[]).filter((s) => s.split("|")[1] === intent).sort((a, b) => h(a).localeCompare(h(b))).slice(0, 2);
  const cases = [...pick("companion"), ...pick("decide"), ...pick("clarify")];
  expect(cases).toHaveLength(6);
  const md = ["# v2.13 人工抽检（6 例）", "", "从 heldout9 的基础组合里，陪伴、决定、理清各取 2 例，用当前引擎渲染（已包含 P13、S02 两处修正）。结论只由你填写，AI 不代填。", "", "每例请给：**可用 / 部分可用 / 不行**，并写一句：哪句有用、哪句多余、行动你愿不愿意做。", ""];
  cases.forEach((spec, i) => {
    const req = requestOf(spec), r = buildLocalReading(req);
    md.push(`## 例 ${i + 1}`, "", `${TOPIC_LABELS[req.topic]}｜${INTENT_LABELS[req.intent!]}｜${req.cards.map((c, j) => `${["此刻", "阻碍", "下一步"][j]} ${getCard(c.cardId as never).nameZh}${c.reversed ? "（逆位）" : ""}`).join(" / ")}`, "", `<!-- spec: ${spec} -->`, "",
      `**整体**：${r.overall}`, "", ...r.cards.map((c, j) => `- ${["此刻", "阻碍", "下一步"][j]}：${c.text}`), "", `**读法一**：${r.interpretations[0]}`, "", `**读法二**：${r.interpretations[1]}`, "", `**行动**：${r.action}`, "", `**追问**：${r.question}`, "", "> 你的结论：（可用 / 部分可用 / 不行）", "> 说明：", "");
  });
  writeFileSync(out, md.join("\n"));
});
