// V211_REVIEW=1 pnpm vitest run evals/print-v211-review.test.ts
// Only run after candidate freeze. One anonymous file for the independent reviewer;
// the key and all 42 frozen outputs are kept separately for later decoding.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import heldout from "../docs/local-reading-expansion/batch-0-heldout.json";
import baseline from "./local-quality/baseline-v2.10.json";
import round2Baseline from "./local-quality/baseline-v2.10-round2.json";
import { digest, requestOf } from "./local-quality/v211-corpus";
import { LOCAL_V2, buildLocalReading, selectLocalFocus } from "@/features/reading/local";
import { getCard } from "@/features/cards/cards";
import { TOPIC_LABELS } from "@/features/cards/schema";
import { INTENT_LABELS } from "@/features/profile/intent";
import { readingResultSchema, type ReadingResult } from "@/features/reading/contract";

it.skipIf(process.env.V211_REVIEW !== "1")("freeze v2.11 and prepare the single anonymous review file", () => {
  throw new Error("Retired in v2.12: the v2.11 engine and content are preserved in tmp/v211-candidate; this generator no longer matches the live code.");
  const round2 = process.env.V211_REVIEW_ROUND === "2";
  const prefix = `docs/local-reading-expansion/batch-0-v211${round2 ? "-round2" : ""}`;
  const protocol = round2 ? heldout.heldout4Protocol : heldout.heldout3Protocol;
  const specs = [...(round2 ? heldout.heldout4 : heldout.heldout3), ...protocol.mechanism, ...protocol.swaps.flat()];
  expect(digest(specs)).toBe(protocol.inputsDigest);
  expect(LOCAL_V2.version).toBe("local-v2.11-sample");
  expect(existsSync(`${prefix}-frozen.json`), "Never overwrite a reviewed candidate").toBe(false);
  const candidate = specs.map(spec => ({ spec, focus: selectLocalFocus(requestOf(spec)), output: buildLocalReading(requestOf(spec)) }));
  const hashFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const frozen = {
    version: LOCAL_V2.version, frozenAt: new Date().toISOString(), inputsDigest: protocol.inputsDigest,
    contentHash: hashFile("content/local-reading-v2.json"), engineHash: hashFile("src/features/reading/local.ts"),
    outputDigest: digest(candidate), outputs: candidate,
  };
  const fresh = (spec: string) => candidate.find(x => x.spec === spec)!.output;
  const before = (spec: string) => readingResultSchema.parse((round2 ? round2Baseline : baseline).heldout.find(x => x.spec === spec)!.output);
  const context = (spec: string) => {
    const req = requestOf(spec);
    return `主题：${TOPIC_LABELS[req.topic]}；意图：${INTENT_LABELS[req.intent!]}\n\n${req.cards.map((c, i) => `${["此刻", "阻碍", "下一步"][i]}：${getCard(c.cardId as never).nameZh}（${c.reversed ? "逆位" : "正位"}）`).join(" / ")}`;
  };
  const render = (r: ReadingResult) => `整体：${r.overall}\n\n${r.cards.map((c, i) => `${["此刻", "阻碍", "下一步"][i]}说明：${c.text}`).join("\n\n")}\n\n读法一：${r.interpretations[0]}\n\n读法二：${r.interpretations[1]}\n\n行动：${r.action}\n\n追问：${r.question}`;
  const seed = `v211-final-blind-20261012${round2 ? "-round2" : ""}`;
  const ordered = <T,>(items: T[], label: string) => [...items].sort((a, b) => digest([seed, label, a]).localeCompare(digest([seed, label, b])));
  const blocks: string[] = [], key: { id: string; kind: string; specs: string[]; a: string; b: string }[] = [];
  const blinded = (id: string, kind: string, specs: string[], values: [string, ReadingResult][], flip: boolean) => {
    if (round2) id = `R2-${id}`;
    const [a, b] = flip ? [...values].reverse() : values;
    const [sa, sb] = specs.length === 1 ? [specs[0], specs[0]] : (flip ? [...specs].reverse() : specs);
    key.push({ id, kind, specs: [sa, sb], a: a[0], b: b[0] });
    blocks.push(`## ${id}\n\n### 甲\n\n${context(sa)}\n\n${render(a[1])}\n\n### 乙\n\n${context(sb)}\n\n${render(b[1])}`);
  };
  const versionFlips = new Set(ordered(protocol.blind, "version-labels").slice(0, 9));
  const mechanismFlips = new Set(ordered(protocol.mechanism, "mechanism-labels").slice(0, 3));
  const swapFlips = new Set(ordered(protocol.swaps, "swap-labels").slice(0, 3).map(pair => digest(pair)));
  ordered(protocol.blind, "versions").forEach((spec, i) => blinded(`P${String(i + 1).padStart(2, "0")}`, "version", [spec], [["before", before(spec)], ["after", fresh(spec)]], round2 ? versionFlips.has(spec) : i % 2 === 0));
  // Evaluation-only alternative: change exactly reading one, with the same topic and
  // companion protection. No anchor choice is added to the production renderer.
  ordered(protocol.mechanism, "mechanism").forEach((spec, i) => {
    const req = requestOf(spec), r = fresh(spec), focus = LOCAL_V2.focuses.find(f => f.id === selectLocalFocus(req))!;
    if (!focus.fallback) throw new Error("Expected fallback");
    const sides = req.cards.map(c => LOCAL_V2.cards[c.cardId][c.reversed ? "reversed" : "upright"]);
    const index = [1, 0, 2].find(p => sides[p].tags.some(t => focus.requireAny.includes(t)))!;
    expect(index).not.toBe(1);
    const side = sides[index];
    // v2.12 removed the tag-keyed obstacle variants this generator read; the v2.11 candidate is kept in tmp/v211-candidate.
    const check = side.byTopic?.[req.topic]?.obstacle?.check ?? side.obstacle.check;
    const alternative: ReadingResult = { ...r, interpretations: [check.replaceAll("{in}", LOCAL_V2.locative[req.topic]), r.interpretations[1]] };
    blinded(`M${i + 1}`, "mechanism", [spec], [["anchor", alternative], ["obstacle", r]], round2 ? mechanismFlips.has(spec) : i % 2 === 1);
  });
  ordered(protocol.swaps, "swaps").forEach((pair, i) => blinded(`S${i + 1}`, "swap", pair, [["first-draw", fresh(pair[0])], ["second-draw", fresh(pair[1])]], round2 ? swapFlips.has(digest(pair)) : i % 2 === 0));
  const rubric = `# 匿名解读对照材料\n\n只读本文件，不查其他材料，不猜版本或作者。P01–P18 是同牌阵的两种文本；M1–M6 只有读法一不同；S1–S6 换了末牌，检查建议的实质差异。甲乙在每组独立打乱。未提供问题正文，请只按主题、意图和牌阵判断。\n\n每段按观点、三牌关联、主题、行动、语言各给 0–2 分（0=缺失或明显问题，1=部分，2=充分），不要因字数或措辞变化自动加分。单独判断重点→核对条件→下一步是否连成一条线 coherent=true/false；套一句收尾不算因果证据。三牌关联看三张牌是否各有有意义的贡献，而不是只数是否出现牌名。保留问题原句，具体矛盾不能被总体偏好抵消。\n\n陪伴样本另逐项给出分析负担、任务数量/负担、完成压力各 0–2（越低越轻），拒绝空间 0–2（越高越足）。同时看整体、逐牌说明、两条读法、行动与追问，不只看是否要求书写。明确比较是否有一方增加负担及原句。\n\n返回一个 JSON 对象：{versionPairs:[{id,a:{scores:[五项],coherent:boolean,evidence:string,burden:null或{analysis:number,tasks:number,pressure:number,optOut:number}},b:同结构,prefer:"甲"|"乙"|"平",burdenRegression:"甲更重"|"乙更重"|"无"|"不适用",issues:[原句及问题]}],mechanismPairs:[{id,aCoherent:boolean,bCoherent:boolean,prefer:"甲"|"乙"|"平",evidence:string,issues:[string]}],swapPairs:[{id,meaningfulDifference:boolean,coherentA:boolean,coherentB:boolean,evidence:string,issues:[string]}],conclusion:string,limitations:[string]}。共 18+6+6 对，不漏例；evidence 简明但引用必要原句。\n\n---\n\n`;
  writeFileSync(`${prefix}-frozen.json`, JSON.stringify(frozen, null, 2) + "\n");
  writeFileSync(`${prefix}-blind-key.json`, JSON.stringify({ seed, outputDigest: frozen.outputDigest, cases: key }, null, 2) + "\n");
  writeFileSync(`${prefix}-blind.md`, rubric + blocks.join("\n\n---\n\n") + "\n");
  if (round2) appendFileSync("docs/local-reading-expansion/batch-0-v211-blind.md", "\n\n# 第二轮：新增匿名材料（R2 编号）\n\n请只对以下 R2 编号评分，使用文件头部同一套规则；不把上一轮评分计入本轮。\n\n" + blocks.join("\n\n---\n\n") + "\n");
  console.log(`Frozen ${candidate.length} outputs; prepared ${key.length} pairs. No heldout text printed.`);
});
