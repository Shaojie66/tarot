// V213_BLIND=1 pnpm vitest run evals/print-v213-blind.test.ts（第一轮）；V213_BLIND=r2 …（第二轮：只比停法之间）
// 开发用：为 v2.13 小样生成小规模盲评材料（同一阻碍位换末牌的成对对照）。匿名材料与答案键分开写入；拒绝覆盖已有材料。
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildLocalReading, selectFallbackLens, selectFallbackMode, selectLocalFocus } from "@/features/reading/local";
import { getCard } from "@/features/cards/cards";
import { TOPIC_LABELS } from "@/features/cards/schema";
import { INTENT_LABELS } from "@/features/profile/intent";
import type { ReadingResult } from "@/features/reading/contract";
import { corpus, specOf } from "./local-quality/v211-corpus";

type Pair = [topic: "career" | "relationship" | "self" | "crossroads", intent: "clarify" | "decide", obstacle: string, nextA: string, nextB: string, probe: string];
// 每对检验一种方式差异；阻碍位与末牌写作 card 或 card:r
const PAIRS_R1: Pair[] = [
  ["self", "clarify", "eight-of-wands", "four-of-swords", "knight-of-swords:r", "歇 vs 停一拍"],
  ["relationship", "clarify", "knight-of-swords:r", "queen-of-wands:r", "page-of-cups:r", "补 vs 缓"],
  ["career", "clarify", "three-of-pentacles:r", "four-of-swords", "the-tower:r", "歇 vs 查证"],
  ["crossroads", "clarify", "page-of-pentacles:r", "the-tower", "knight-of-swords", "减一项 vs 小试"],
  ["career", "clarify", "knight-of-swords:r", "death", "the-tower:r", "回看 vs 查证"],
  ["self", "clarify", "page-of-pentacles:r", "page-of-cups:r", "four-of-swords", "缓 vs 歇"],
  ["relationship", "clarify", "eight-of-wands", "page-of-pentacles:r", "the-tower", "小试 vs 停一拍"],
  ["crossroads", "clarify", "page-of-pentacles:r", "death", "queen-of-wands:r", "减一项 vs 补"],
  ["career", "decide", "eight-of-wands", "four-of-swords", "knight-of-swords:r", "歇 vs 停一拍"],
  ["self", "decide", "page-of-pentacles:r", "queen-of-wands:r", "the-tower", "补 vs 减一项"],
  ["crossroads", "decide", "knight-of-swords:r", "page-of-cups:r", "the-tower:r", "缓 vs 查证"],
  ["relationship", "decide", "death", "knight-of-swords", "page-of-cups:r", "收集句 vs 缓"],
  ["career", "decide", "three-of-pentacles:r", "page-of-pentacles", "knight-of-swords", "查证 vs 写下来"],
  ["self", "decide", "knight-of-swords:r", "death", "four-of-swords", "回看 vs 歇"],
];
// 第二轮：停法改写后（歇＝醒后最先冒出来的、补＝哪部分耗劲、缓＝情绪与事实分开、停一拍不变），只比停法之间；只用已试写的两个阻碍位
const PAIRS_R2: Pair[] = [
  ["career", "clarify", "eight-of-wands", "knight-of-swords:r", "four-of-swords", "停一拍 vs 歇"],
  ["self", "clarify", "eight-of-wands", "four-of-swords", "page-of-cups:r", "歇 vs 缓"],
  ["relationship", "clarify", "eight-of-wands", "queen-of-wands:r", "page-of-cups:r", "补 vs 缓"],
  ["crossroads", "clarify", "eight-of-wands", "queen-of-wands:r", "knight-of-swords:r", "补 vs 停一拍"],
  ["self", "decide", "eight-of-wands", "four-of-swords", "queen-of-wands:r", "歇 vs 补"],
  ["career", "decide", "eight-of-wands", "knight-of-swords:r", "page-of-cups:r", "停一拍 vs 缓"],
  ["career", "clarify", "page-of-pentacles:r", "four-of-swords", "queen-of-wands:r", "歇 vs 补"],
  ["relationship", "clarify", "page-of-pentacles:r", "queen-of-wands:r", "page-of-cups:r", "补 vs 缓"],
  ["crossroads", "decide", "page-of-pentacles:r", "four-of-swords", "page-of-cups:r", "歇 vs 缓"],
  ["career", "decide", "page-of-pentacles:r", "four-of-swords", "queen-of-wands:r", "歇 vs 补"],
];
// 第三轮：停一拍改为“现在、两分钟”后补测歇 ↔ 停一拍；另三个阻碍位的停法改写后测停法之间
const PAIRS_R3: Pair[] = [
  ["self", "clarify", "eight-of-wands", "four-of-swords", "knight-of-swords:r", "歇 vs 停一拍"],
  ["crossroads", "decide", "eight-of-wands", "four-of-swords", "knight-of-swords:r", "歇 vs 停一拍"],
  ["career", "clarify", "knight-of-swords:r", "four-of-swords", "the-tower", "歇 vs 停一拍"],
  ["relationship", "decide", "knight-of-swords:r", "four-of-swords", "the-tower", "歇 vs 停一拍"],
  ["self", "clarify", "knight-of-swords:r", "four-of-swords", "queen-of-wands:r", "歇 vs 补"],
  ["crossroads", "clarify", "knight-of-swords:r", "queen-of-wands:r", "page-of-cups:r", "补 vs 缓"],
  ["career", "decide", "knight-of-swords:r", "four-of-swords", "page-of-cups:r", "歇 vs 缓"],
  ["career", "clarify", "three-of-pentacles:r", "four-of-swords", "page-of-cups:r", "歇 vs 缓"],
  ["self", "decide", "three-of-pentacles:r", "four-of-swords", "page-of-cups:r", "歇 vs 缓"],
  ["relationship", "clarify", "three-of-pentacles:r", "four-of-swords", "page-of-cups:r", "歇 vs 缓"],
];
// 第四轮（A 批）：14 张新末牌。每个已写阻碍位 × 理清 / 决定各一对，两侧都是新末牌、所选方式不同；另加 3 对陪伴
const NEW_NEXT = ["the-hermit", "the-hermit:r", "death:r", "queen-of-wands", "eight-of-wands", "eight-of-wands:r", "page-of-cups", "four-of-swords:r", "six-of-swords", "six-of-swords:r", "two-of-pentacles", "two-of-pentacles:r", "three-of-pentacles", "three-of-pentacles:r"];
const R4_OBSTACLES = ["eight-of-wands", "death", "knight-of-swords:r", "three-of-pentacles:r", "page-of-pentacles:r"];
type Intent = Pair[1] | "companion";
// 第五轮（B 批）：6 个新阻碍位 × 理清 / 决定各一对，末牌不限，两侧方式不同
const R5_OBSTACLES = ["knight-of-swords", "the-tower:r", "eight-of-wands:r", "six-of-swords:r", "four-of-swords:r", "the-hermit:r"];
// 第六轮（C 批）
const R6_OBSTACLES = ["queen-of-wands:r", "six-of-swords", "two-of-pentacles:r", "four-of-swords", "queen-of-wands", "two-of-pentacles"];
// 第七轮：C 批未过线，修正后用新组合复评同一批阻碍位
// 第八轮（D 批）
const R8_OBSTACLES = ["three-of-pentacles", "page-of-pentacles", "death:r", "the-tower", "the-hermit", "page-of-cups", "page-of-cups:r"];
// 第九轮：D 批差 1 侧未过线，修正后用新组合复评
// 第十轮：读法二全局重写后，跨批抽样复评（24 个阻碍位里按指纹取 14 个，意图交替）
const ALL_OBSTACLES = ["the-hermit", "the-hermit:r", "the-tower", "the-tower:r", "death", "death:r", "queen-of-wands", "queen-of-wands:r", "eight-of-wands", "eight-of-wands:r", "page-of-cups", "page-of-cups:r", "four-of-swords", "four-of-swords:r", "six-of-swords", "six-of-swords:r", "knight-of-swords", "knight-of-swords:r", "two-of-pentacles", "two-of-pentacles:r", "three-of-pentacles", "three-of-pentacles:r", "page-of-pentacles", "page-of-pentacles:r"];
const ROUND = (["r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"] as const).find((r) => process.env.V213_BLIND === r) ?? "r1";
const PAIRS: (Omit<Pair, 1> & { 1: Intent } | Pair)[] = ROUND === "r3" ? PAIRS_R3 : ROUND === "r2" ? PAIRS_R2 : ROUND === "r1" ? PAIRS_R1 : [];
// 校准 6 例及其换牌对照不进盲评；第二轮也排除第一轮评审已看过的组合
const EXCLUDE = new Set([
  "self|decide|three-of-pentacles:r,page-of-pentacles:r,the-tower", "career|decide|four-of-swords,eight-of-wands,page-of-pentacles", "career|decide|four-of-swords,eight-of-wands,knight-of-swords:r",
  "career|companion|the-hermit,death,knight-of-swords:r", "relationship|companion|the-hermit,knight-of-swords:r,page-of-pentacles:r", "career|clarify|death,three-of-pentacles:r,the-tower:r",
  "career|clarify|death,three-of-pentacles:r,knight-of-swords", "relationship|clarify|knight-of-swords,page-of-pentacles:r,death", "relationship|clarify|knight-of-swords,page-of-pentacles:r,the-tower",
]);
const seenKeys = ROUND === "r10" ? ["", "-r2", "-r3", "-r4", "-r5", "-r6", "-r7", "-r8", "-r9"] : ROUND === "r9" ? ["", "-r2", "-r3", "-r4", "-r5", "-r6", "-r7", "-r8"] : ROUND === "r8" ? ["", "-r2", "-r3", "-r4", "-r5", "-r6", "-r7"] : ROUND === "r7" ? ["", "-r2", "-r3", "-r4", "-r5", "-r6"] : ROUND === "r6" ? ["", "-r2", "-r3", "-r4", "-r5"] : ROUND === "r5" ? ["", "-r2", "-r3", "-r4"] : ROUND === "r4" ? ["", "-r2", "-r3"] : ROUND === "r3" ? ["", "-r2"] : ROUND === "r2" ? [""] : [];
for (const suffix of seenKeys) for (const p of (JSON.parse(readFileSync(`docs/local-reading-expansion/batch-0-v213-blind${suffix}-key.json`, "utf8")) as { pairs: { a: { spec: string }; b: { spec: string } }[] }).pairs) { EXCLUDE.add(p.a.spec); EXCLUDE.add(p.b.spec); }
const tag = (c: { cardId: string; reversed: boolean }) => `${c.cardId}${c.reversed ? ":r" : ""}`;
const h = (s: string) => createHash("sha256").update(s).digest("hex");
const render = (r: ReadingResult) => [`整体：${r.overall}`, ...r.cards.map((c, i) => `${["此刻", "阻碍", "下一步"][i]}说明：${c.text}`), `读法一：${r.interpretations[0]}`, `读法二：${r.interpretations[1]}`, `行动：${r.action}`, `追问：${r.question}`].join("\n\n");

it.skipIf(!["1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"].includes(process.env.V213_BLIND ?? ""))("prepare v2.13 blind pairs", () => {
  const base = `docs/local-reading-expansion/batch-0-v213-blind${ROUND === "r1" ? "" : `-${ROUND}`}`;
  expect(existsSync(`${base}.md`), "不覆盖已有盲评材料").toBe(false);
  const blind: string[] = [], key: unknown[] = [];
  if (["r4", "r5", "r6", "r7", "r8", "r9", "r10"].includes(ROUND)) {
    const topics = ["career", "relationship", "self", "crossroads"] as const;
    let t = 0;
    const modeOfReq = (r: ReturnType<typeof corpus> extends Generator<infer R> ? R : never, intent: Intent) => { const m = selectFallbackMode(r); return m ? (intent === "decide" ? m.decide : m.clarify) : null; };
    const jobs: [Intent, string][] = ROUND === "r10"
      ? [...ALL_OBSTACLES].sort((x, y) => h(x + "r10").localeCompare(h(y + "r10"))).slice(0, 14).map((o, i) => [i % 2 ? "decide" : "clarify", o] as [Intent, string])
      : ROUND !== "r4"
      ? (ROUND === "r8" || ROUND === "r9" ? R8_OBSTACLES : ROUND === "r6" || ROUND === "r7" ? R6_OBSTACLES : R5_OBSTACLES).flatMap((o) => [["clarify", o], ["decide", o]] as [Intent, string][])
      : [...R4_OBSTACLES.flatMap((o) => [["clarify", o], ["decide", o]] as [Intent, string][]), ["companion", "eight-of-wands"], ["companion", "page-of-pentacles:r"], ["companion", "death"]];
    const nextPool = (n: string) => ROUND !== "r4" || NEW_NEXT.includes(n);
    for (const [intent, obstacle] of jobs) {
      let done = false;
      for (let attempt = 0; attempt < 4 && !done; attempt++) {
        const topic = topics[(t + attempt) % 4];
        const reqs = [...corpus(topic, intent as never)].filter((r) => tag(r.cards[1]) === obstacle && nextPool(tag(r.cards[2])) && selectFallbackLens(r) === "v2.13" && !EXCLUDE.has(specOf(r)));
        const byFirst = new Map<string, typeof reqs>();
        for (const r of reqs) byFirst.set(tag(r.cards[0]), [...(byFirst.get(tag(r.cards[0])) ?? []), r]);
        const firsts = [...byFirst.keys()].sort((x, y) => h(x + obstacle + intent + ROUND).localeCompare(h(y + obstacle + intent + ROUND)));
        for (const f of firsts) {
          const list = byFirst.get(f)!.sort((x, y) => h(specOf(x)).localeCompare(h(specOf(y))));
          const a = list[0], b = list.find((r) => tag(r.cards[2]) !== tag(a.cards[2]) && (intent === "companion" || modeOfReq(r, intent) !== modeOfReq(a, intent)));
          if (b) { PAIRS.push([topic, intent as Pair[1], obstacle, tag(a.cards[2]), tag(b.cards[2]), `${({ r4: "A", r5: "B", r6: "C", r7: "C", r8: "D", r9: "D", r10: "跨" } as Record<string, string>)[ROUND]} 批：${intent}`]); done = true; break; }
        }
      }
      expect(done, `r4 ${intent} ${obstacle}: 找不到合适的一对`).toBe(true);
      t++;
    }
  }
  PAIRS.forEach(([wanted, intent, obstacle, nextA, nextB, probe], i) => {
    // 找同一张“此刻”牌，使两侧都走后备主张且用上 v2.13 写法；指定主题没有这样的组合时，按固定顺序换主题
    const pick = (topic: Pair[0], next: string) => [...corpus(topic, intent)].filter((r) => tag(r.cards[1]) === obstacle && tag(r.cards[2]) === next && selectFallbackLens(r) === "v2.13" && !EXCLUDE.has(specOf(r)));
    const found = ([wanted, ...(["career", "relationship", "self", "crossroads"] as const).filter((t) => t !== wanted)] as Pair[0][]).map((topic) => {
      const a = pick(topic, nextA), b = pick(topic, nextB);
      const firsts = a.map((r) => tag(r.cards[0])).filter((f) => b.some((r) => tag(r.cards[0]) === f)).sort((x, y) => h(x + i).localeCompare(h(y + i)));
      return firsts.length ? { topic, reqA: a.find((r) => tag(r.cards[0]) === firsts[0])!, reqB: b.find((r) => tag(r.cards[0]) === firsts[0])! } : null;
    }).find((x) => x !== null);
    expect(found, `pair ${i + 1} ${probe}: 四个主题都没有共同的此刻牌`).toBeDefined();
    const { topic, reqA, reqB } = found!;
    const swap = h(`side${i}`)[0] < "8";
    const [x, y] = swap ? [reqB, reqA] : [reqA, reqB];
    const label = (r: typeof x) => r.cards.map((c, j) => `${["此刻", "阻碍", "下一步"][j]}：${getCard(c.cardId as never).nameZh}（${c.reversed ? "逆位" : "正位"}）`).join(" / ");
    blind.push(`## 第 ${i + 1} 对\n\n主题：${TOPIC_LABELS[topic]}；意图：${INTENT_LABELS[intent]}\n\n### 甲\n\n${label(x)}\n\n\`\`\`\n${render(buildLocalReading(x))}\n\`\`\`\n\n### 乙\n\n${label(y)}\n\n\`\`\`\n${render(buildLocalReading(y))}\n\`\`\`\n`);
    const mode = (r: typeof x) => { const m = selectFallbackMode(r)!; return intent === "clarify" ? m.clarify : m.decide; };
    key.push({ pair: i + 1, probe, a: { spec: specOf(x), focus: selectLocalFocus(x), mode: mode(x) }, b: { spec: specOf(y), focus: selectLocalFocus(y), mode: mode(y) } });
  });
  writeFileSync(`${base}.md`, `# v2.13 小样盲评材料（${({ r1: "", r2: "第二轮，", r3: "第三轮，", r4: "第四轮，", r5: "第五轮，", r6: "第六轮，", r7: "第七轮，", r8: "第八轮，", r9: "第九轮，", r10: "第十轮，" } as const)[ROUND]}${PAIRS.length} 对）\n\n每对是同一主题、同一意图、同一张“此刻”和“阻碍”牌，只换了“下一步”牌。甲乙顺序已随机。\n\n${blind.join("\n")}`);
  writeFileSync(`${base}-key.json`, JSON.stringify({ note: "答案键：评审完成前不要给评审者看。", pairs: key }, null, 1) + "\n");
}, 180000);
