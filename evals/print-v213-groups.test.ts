// V213_GROUPS=1 pnpm vitest run evals/print-v213-groups.test.ts
// 生成 / 更新人工审读表：保留指纹未变的组的 reviewed；指纹变了的组 reviewed 清空（重新审）。从不代填 reviewed。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { getCard } from "@/features/cards/cards";
import { LOCAL_CONTRACT } from "@/features/reading/local";
import { buildReviewGroups } from "./local-quality/v213-review-groups";

const JSON_PATH = "evals/local-quality/v213-mode-table.json";
const MD_PATH = "docs/local-reading-expansion/v213-review-groups.md";
const MODE_LABEL: Record<string, string> = { recall: "回看", trial: "小试", check: "查证", say: "写下来", pause: "停一拍", drop: "减一项", rest: "歇", refuel: "补", settle: "缓", skip: "跳过（退回 v2.12）", gather: "收集句" };
const side = (k: string) => { const [id, o] = k.split("/"); return `${getCard(id as never).nameZh}${o === "reversed" ? "逆" : "正"}`; };

it.skipIf(process.env.V213_GROUPS !== "1")("update review groups", () => {
  const groups = buildReviewGroups();
  const old = existsSync(JSON_PATH) ? (JSON.parse(readFileSync(JSON_PATH, "utf8")).groups ?? {}) : {};
  let kept = 0, reset = 0;
  const table: Record<string, { fingerprint: string; reviewed: string | null; aiReviewed: string | null }> = {};
  for (const [k, g] of Object.entries(groups)) {
    const prev = old[k];
    const reviewed = prev && prev.fingerprint === g.fingerprint ? prev.reviewed : null;
    if (prev?.reviewed != null) { if (reviewed === null) reset++; else kept++; }
    // AI 代审结论同样绑定指纹：内容一变就清空，需重审
    table[k] = { fingerprint: g.fingerprint, reviewed, aiReviewed: prev && prev.fingerprint === g.fingerprint ? (prev.aiReviewed ?? null) : null };
  }
  writeFileSync(JSON_PATH, JSON.stringify({ note: "v2.13 人工审读表：一组 = 阻碍位的一句行动 × 用到它的末牌。reviewed 只能由用户填写（如 \"ok\" 或修改意见），AI 不得代填；指纹变化时由生成器清空，需重新审。逐组内容见 docs/local-reading-expansion/v213-review-groups.md。", groups: table }, null, 1) + "\n");
  const md = ["# v2.13 人工审读：阻碍位的一句 × 用到它的末牌", "", "每组看一件事：这句行动放在这些末牌后面（连同各自的读法二），读起来是否连贯、是否合牌义。在 `evals/local-quality/v213-mode-table.json` 对应组的 `reviewed` 里填 `ok` 或意见。", ""];
  for (const [k, g] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
    const o0 = LOCAL_CONTRACT.obstacle[g.obstacle], o = (g.topic ? o0.byTopic?.[g.topic as never] : undefined) ?? o0;
    const yardstick = g.intent === "clarify" ? `判断标准：${o.standard.replaceAll("{in}", "")}` : `比较标准：${(o.compare ?? "").replaceAll("{in}", "")}`;
    md.push(`## ${k}`, "", `${g.intent === "clarify" ? "理清" : "决定"}｜阻碍 ${side(g.obstacle)}${g.topic ? `（${g.topic} 主题）` : ""}｜方式 ${MODE_LABEL[g.mode]}｜指纹 \`${g.fingerprint}\`${table[k].reviewed ? `｜已审：${table[k].reviewed}` : ""}`, "", yardstick, "", `> ${g.text ?? "（无）"}`, "");
    for (const m of g.members) md.push(`- ${side(m.next)}：${m.reading}`);
    md.push("");
  }
  writeFileSync(MD_PATH, md.join("\n"));
  console.log("GROUPS", Object.keys(table).length, "kept", kept, "reset", reset);
});
