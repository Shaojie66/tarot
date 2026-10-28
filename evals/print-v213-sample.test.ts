// V213_SAMPLE=1 pnpm vitest run evals/print-v213-sample.test.ts
// 开发用：渲染 v2.13 结构小样（校准 6 例及其换末牌对照），并统计语料里实际走 v2.13 槽的组合。写到 tmp/，不进验收。
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LOCAL_CONTRACT, buildLocalReading, selectFallbackLens, selectFallbackMode, selectLocalFocus } from "@/features/reading/local";
import { getCard } from "@/features/cards/cards";
import { TOPICS, TOPIC_LABELS } from "@/features/cards/schema";
import { INTENTS, INTENT_LABELS } from "@/features/profile/intent";
import type { ReadingResult } from "@/features/reading/contract";
import { corpus, requestOf, specOf } from "./local-quality/v211-corpus";

const CALIBRATION: [string, string, string?][] = [
  ["P07 甲", "self|decide|three-of-pentacles:r,page-of-pentacles:r,the-tower"],
  ["S01 乙", "career|decide|four-of-swords,eight-of-wands,page-of-pentacles", "career|decide|four-of-swords,eight-of-wands,knight-of-swords:r"],
  ["P16 乙", "career|companion|the-hermit,death,knight-of-swords:r"],
  ["P17 乙", "relationship|companion|the-hermit,knight-of-swords:r,page-of-pentacles:r"],
  ["S10 乙", "career|clarify|death,three-of-pentacles:r,the-tower:r", "career|clarify|death,three-of-pentacles:r,knight-of-swords"],
  ["S11 甲", "relationship|clarify|knight-of-swords,page-of-pentacles:r,death", "relationship|clarify|knight-of-swords,page-of-pentacles:r,the-tower"],
];

const head = (spec: string) => {
  const req = requestOf(spec);
  return `${TOPIC_LABELS[req.topic]}｜${INTENT_LABELS[req.intent!]}｜${req.cards.map((c, i) => `${["此刻", "阻碍", "下一步"][i]} ${getCard(c.cardId as never).nameZh}${c.reversed ? "（逆位）" : ""}`).join(" / ")}｜主张 ${selectLocalFocus(req)}｜写法 ${selectFallbackLens(req)}${(() => { const m = selectFallbackMode(req); return m ? `｜方式 ${req.intent === "decide" ? m.decide : req.intent === "clarify" ? m.clarify : "-"}` : ""; })()}`;
};
const render = (r: ReadingResult) => [`整体：${r.overall}`, ...r.cards.map((c, i) => `${["此刻", "阻碍", "下一步"][i]}说明：${c.text}`), `读法一：${r.interpretations[0]}`, `读法二：${r.interpretations[1]}`, `行动：${r.action}`, `追问：${r.question}`].join("\n\n");

it.skipIf(process.env.V213_SAMPLE !== "1")("render v2.13 structure sample", () => {
  const out: string[] = ["# v2.13 结构小样（自动渲染，开发用）\n"];
  for (const [id, spec, swap] of CALIBRATION) {
    out.push(`## ${id}\n\n${head(spec)}\n\n\`\`\`\n${render(buildLocalReading(requestOf(spec)))}\n\`\`\`\n`);
    if (swap) out.push(`换末牌对照：${head(swap)}\n\n\`\`\`\n行动：${buildLocalReading(requestOf(swap)).action}\n追问：${buildLocalReading(requestOf(swap)).question}\n\`\`\`\n`);
  }
  // 语料里实际走 v2.13 的组合：按意图统计，并按“阻碍位 × 末牌”各取一例
  const seen = new Map<string, string>();
  const counts: Record<string, { v213: number; v212: number }> = {};
  for (const topic of TOPICS) for (const intent of INTENTS) for (const req of corpus(topic, intent)) {
    const lens = selectFallbackLens(req);
    if (!lens) continue;
    const c = (counts[intent] ??= { v213: 0, v212: 0 });
    c[lens === "v2.13" ? "v213" : "v212"]++;
    const k = `${intent}|${req.cards[1].cardId}${req.cards[1].reversed ? ":r" : ""}|${req.cards[2].cardId}${req.cards[2].reversed ? ":r" : ""}`;
    if (lens === "v2.13" && !seen.has(k)) seen.set(k, specOf(req));
  }
  // 实测跳过：只看阻碍位和末牌都在小样里写了 v2.13 槽的组合（其余本来就是 v2.12）
  const sampleObs = (k: string) => Object.entries(LOCAL_CONTRACT.obstacle).some(([side, o]) => side === k && o.modes);
  const sampleNext = (k: string) => LOCAL_CONTRACT.next[k]?.modes !== undefined;
  const sk = (c: { cardId: string; reversed: boolean }) => `${c.cardId}/${c.reversed ? "reversed" : "upright"}`;
  const skip = { clarify: { used: 0, skipped: 0 }, decide: { used: 0, gather: 0 } };
  const modesPerObstacle = new Map<string, Set<string>>();
  for (const topic of TOPICS) for (const intent of ["clarify", "decide"] as const) for (const req of corpus(topic, intent)) {
    const m = selectFallbackMode(req);
    if (!m || !sampleObs(sk(req.cards[1])) || !sampleNext(sk(req.cards[2]))) continue;
    if (intent === "clarify") {
      if (m.clarify) skip.clarify.used++; else skip.clarify.skipped++;
      const g = `${topic}|${sk(req.cards[1])}`;
      (modesPerObstacle.get(g) ?? modesPerObstacle.set(g, new Set()).get(g)!).add(m.clarify ?? "skip");
    } else if (m.decide) skip.decide[m.decide === "gather" ? "gather" : "used"]++;
  }
  const spread = Object.fromEntries([...modesPerObstacle].map(([g, set]) => [g, [...set].sort().join(",")]));
  out.push(`## 实测（只算两张牌都写了新槽的组合）\n\n\`\`\`\n${JSON.stringify(skip)}\n${JSON.stringify(spread, null, 1)}\n\`\`\`\n`);
  console.log(JSON.stringify(skip));
  out.push(`## 覆盖\n\n\`\`\`\n${JSON.stringify(counts)}\n\`\`\`\n\n## 阻碍位 × 末牌：每格一例（行动 / 追问）\n`);
  for (const spec of [...seen.values()].sort()) {
    const r = buildLocalReading(requestOf(spec));
    out.push(`- ${head(spec)}\n  - 读法一：${r.interpretations[0]}\n  - 行动：${r.action}\n  - 追问：${r.question}`);
  }
  mkdirSync("tmp", { recursive: true });
  writeFileSync("tmp/v213-sample.md", out.join("\n") + "\n");
  expect(seen.size).toBeGreaterThan(0);
  console.log(JSON.stringify({ counts, cells: seen.size }));
}, 180000);
