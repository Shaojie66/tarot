// V213_FINAL5=1 pnpm vitest run evals/print-v213-final5.test.ts
// Run once, after the candidate is complete. Freezes the v2.13 outputs for heldout10 and writes one anonymous review file
// plus a key kept apart from it. Refuses to overwrite a frozen candidate. Prints no heldout text.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import heldout from "../docs/local-reading-expansion/batch-0-heldout.json";
import baseline from "./local-quality/baseline-v2.10-heldout10.json";
import { digest, requestOf } from "./local-quality/v211-corpus";
import { LOCAL_V2, buildLocalReading, selectLocalFocus } from "@/features/reading/local";
import { getCard } from "@/features/cards/cards";
import { TOPIC_LABELS } from "@/features/cards/schema";
import { INTENT_LABELS } from "@/features/profile/intent";
import { readingResultSchema, type ReadingResult } from "@/features/reading/contract";

it.skipIf(process.env.V213_FINAL5 !== "1")("freeze v2.13 and prepare the anonymous review file", () => {
  const prefix = "docs/local-reading-expansion/batch-0-v213-final5";
  const protocol = heldout.heldout10Protocol;
  const swaps = protocol.swaps as [string, string][];
  const specs = [...heldout.heldout10, ...swaps.map(([, swapped]) => swapped)];
  expect(digest(specs)).toBe(protocol.inputsDigest);
  expect(LOCAL_V2.version).toBe("local-v2.13-sample");
  expect(existsSync(`${prefix}-frozen.json`), "Never overwrite a frozen candidate").toBe(false);
  expect(protocol.candidateFreeze).toBeNull();

  const candidate = specs.map((spec) => ({ spec, focus: selectLocalFocus(requestOf(spec)), output: buildLocalReading(requestOf(spec)) }));
  const hashFile = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const frozen = {
    version: LOCAL_V2.version, frozenAt: new Date().toISOString(), inputsDigest: protocol.inputsDigest,
    contentHash: hashFile("content/local-reading-v2.json"), contractHash: hashFile("content/local-reading-v2-contract.json"), engineHash: hashFile("src/features/reading/local.ts"),
    outputDigest: digest(candidate), outputs: candidate,
  };
  const fresh = (spec: string) => candidate.find((x) => x.spec === spec)!.output;
  const before = (spec: string) => readingResultSchema.parse(baseline.heldout.find((x) => x.spec === spec)!.output);

  const context = (spec: string) => {
    const req = requestOf(spec);
    return `主题：${TOPIC_LABELS[req.topic]}；意图：${INTENT_LABELS[req.intent!]}\n\n${req.cards.map((c, i) => `${["此刻", "阻碍", "下一步"][i]}：${getCard(c.cardId as never).nameZh}（${c.reversed ? "逆位" : "正位"}）`).join(" / ")}`;
  };
  const render = (r: ReadingResult) => `整体：${r.overall}\n\n${r.cards.map((c, i) => `${["此刻", "阻碍", "下一步"][i]}说明：${c.text}`).join("\n\n")}\n\n读法一：${r.interpretations[0]}\n\n读法二：${r.interpretations[1]}\n\n行动：${r.action}\n\n追问：${r.question}`;

  const seed = "v213-final5-20261027";
  const ordered = <T,>(items: T[], label: string) => [...items].sort((a, b) => digest([seed, label, a]).localeCompare(digest([seed, label, b])));
  // Labels are balanced by construction: exactly half of each group puts the new text in 甲.
  const flipSet = <T,>(items: T[], label: string) => new Set(ordered(items, label).slice(0, Math.floor(items.length / 2)));
  const blocks: string[] = [], key: { id: string; kind: string; specs: string[]; a: string; b: string }[] = [];
  const blinded = (id: string, kind: string, specs: string[], values: [string, ReadingResult][], flip: boolean) => {
    const [a, b] = flip ? [...values].reverse() : values;
    const [sa, sb] = specs.length === 1 ? [specs[0], specs[0]] : flip ? [...specs].reverse() : specs;
    key.push({ id, kind, specs: [sa, sb], a: a[0], b: b[0] });
    blocks.push(`## ${id}\n\n### 甲\n\n${context(sa)}\n\n${render(a[1])}\n\n### 乙\n\n${context(sb)}\n\n${render(b[1])}`);
  };
  const versionFlips = flipSet(heldout.heldout10, "version-labels");
  ordered(heldout.heldout10, "versions").forEach((spec, i) => blinded(`P${String(i + 1).padStart(2, "0")}`, "version", [spec], [["before", before(spec)], ["after", fresh(spec)]], versionFlips.has(spec)));
  const swapFlips = flipSet(swaps.map((pair) => digest(pair)), "swap-labels");
  ordered(swaps, "swaps").forEach((pair, i) => blinded(`S${String(i + 1).padStart(2, "0")}`, "swap", pair, [["first-draw", fresh(pair[0])], ["second-draw", fresh(pair[1])]], swapFlips.has(digest(pair))));

  const rubric = `# 匿名解读对照材料\n\n只读本文件，不查其他材料，不猜版本或作者。P01–P18 是同一牌阵的两种文本；S01–S12 是同一主题和意图下，只换了一张牌的两个牌阵，检查后续文字是否随之有实质变化。甲乙在每组独立打乱。未提供问题正文，请只按主题、意图和牌阵判断。\n\n每段按观点、三牌关联、主题、行动、语言各给 0–2 分（0=缺失或明显问题，1=部分，2=充分），不要因字数或措辞变化自动加分。单独判断“重点 → 核对什么 → 下一步行动”是否连成一条线 coherent=true/false：读法里要核对的对象和判断标准，行动是否仍然在做同一件事、用同一个标准；套一句收尾不算因果证据。三牌关联看三张牌是否各有有意义的贡献，而不是只数是否出现牌名。保留问题原句，具体矛盾不能被总体偏好抵消。\n\n陪伴样本另逐项给出分析负担、任务数量/负担、完成压力各 0–2（越低越轻），拒绝空间 0–2（越高越足）。同时看整体、逐牌说明、两条读法、行动与追问，不只看是否要求书写。明确比较是否有一方增加负担及原句。\n\nS 组另判断：meaningfulDifference（后续文字的差异是否来自换掉的那张牌的含义，而不是只换了可互换的小活动）、coherentA、coherentB。意图为“只是陪我说说话”的 S 组按陪伴口径判断：陪伴的行动由“下一步”牌给出，只换“阻碍”牌时行动不变属于设计；此类对比较读法一和阻碍说明是否随换掉的那张牌有实质变化，不因行动、追问相同而判为无变化。非陪伴意图换“下一步”牌时，读法一和追问来自“阻碍”牌、本就不变；若行动换成了另一种观察或做法（例如从“查证一处”换成“先停一拍写一句”，或从“写下来”换成“回看一次具体经历”），即使回答的是同一个标准，也算实质变化；只有行动逐字相同或只换了措辞，才判为无变化。\n\n返回一个 JSON 对象：{versionPairs:[{id,a:{scores:[五项],coherent:boolean,evidence:string,burden:null或{analysis:number,tasks:number,pressure:number,optOut:number}},b:同结构,prefer:"甲"|"乙"|"平",burdenRegression:"甲更重"|"乙更重"|"无"|"不适用",issues:[原句及问题]}],swapPairs:[{id,meaningfulDifference:boolean,coherentA:boolean,coherentB:boolean,evidence:string,issues:[string]}],conclusion:string,limitations:[string]}。共 18+12 对，不漏例；evidence 简明但引用必要原句。\n\n---\n\n`;

  writeFileSync(`${prefix}-frozen.json`, JSON.stringify(frozen, null, 2) + "\n");
  writeFileSync(`${prefix}-blind-key.json`, JSON.stringify({ seed, outputDigest: frozen.outputDigest, cases: key }, null, 2) + "\n");
  writeFileSync(`${prefix}-blind.md`, rubric + blocks.join("\n\n---\n\n") + "\n");

  const record = JSON.parse(readFileSync("docs/local-reading-expansion/batch-0-heldout.json", "utf8"));
  record.heldout10Protocol.candidateFreeze = { version: frozen.version, frozenAt: frozen.frozenAt, inputsDigest: frozen.inputsDigest, contentHash: frozen.contentHash, contractHash: frozen.contractHash, engineHash: frozen.engineHash, outputDigest: frozen.outputDigest };
  record.heldout10Protocol.status = "frozen-not-reviewed";
  record.heldout10Protocol.baseline = { file: "evals/local-quality/baseline-v2.10-heldout10.json", commit: "9148317", note: "Rebuilt from the committed v2.10 engine; reproduces all 42 frozen round-2 outputs before generating." };
  record.heldout10Protocol.blindSeed = seed;
  writeFileSync("docs/local-reading-expansion/batch-0-heldout.json", JSON.stringify(record, null, 1) + "\n");
  console.log(`Frozen ${candidate.length} outputs; prepared ${key.length} pairs. No heldout text printed.`);
});
