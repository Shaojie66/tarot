// 组合扫描：对所有已写完 v2 内容的牌，扫描三牌组合（不穷举正文，检查每个结果的硬约束）。
// 牌少时遍历全部有序三元组；牌多时用固定种子抽样（SWEEP_SAMPLES，默认 20000）。
// 扩写时这是跨批次的自动安全网：新批次的牌会自动和旧批次的牌组合进来。内容是否有用仍靠人工评分。

import { describe, expect, it } from "vitest";
import { TOPICS } from "@/features/cards/schema";
import { readingRequestSchema, readingResultSchema, resultMatchesDraw } from "@/features/reading/contract";
import { findForbiddenPhrase } from "@/features/reading/guard";
import { LOCAL_V2, buildLocalReading, localContentVersion, selectLocalFocus } from "@/features/reading/local";
import { INTENTS } from "@/features/profile/intent";

const ids = Object.keys(LOCAL_V2.cards);
const MAX = Number(process.env.SWEEP_SAMPLES ?? 20000);

/** 固定种子的伪随机（mulberry32），保证每次扫描的抽样一致 */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function* triples(): Generator<[string, string, string]> {
  const total = ids.length * (ids.length - 1) * (ids.length - 2);
  if (total <= MAX) {
    for (const a of ids) for (const b of ids) for (const c of ids) if (a !== b && a !== c && b !== c) yield [a, b, c];
    return;
  }
  const r = rng(20261010);
  for (let i = 0; i < MAX; i++) {
    const pick: string[] = [];
    while (pick.length < 3) {
      const id = ids[Math.floor(r() * ids.length)];
      if (!pick.includes(id)) pick.push(id);
    }
    yield pick as [string, string, string];
  }
}

describe(`组合扫描（${ids.length} 张已写完的牌）`, () => {
  it("每个组合：通过 schema / 牌面一致 / 内容红线；整体不抄逐牌说明；没有残留占位符和已知的坏句式；输出稳定", () => {
    const r = rng(7);
    let n = 0;
    const focusCounts: Record<string, number> = {};
    for (const [a, b, c] of triples()) {
      const topic = TOPICS[Math.floor(r() * TOPICS.length)];
      const intent = INTENTS[Math.floor(r() * INTENTS.length)];
      const cards = [a, b, c].map((cardId, position) => ({ cardId, position, reversed: r() < 0.5 }));
      const request = readingRequestSchema.parse({ spreadId: "three-card", topic, originalQuestion: "q", question: "合成问题", selfReading: "", intent, cards });
      const label = `${a}/${b}/${c} ${topic}/${intent}`;

      const result = buildLocalReading(request);
      readingResultSchema.parse(result);
      expect(resultMatchesDraw(result, request), label).toBe(true);
      const all = [result.overall, ...result.cards.map((x) => x.text), ...result.interpretations, result.action, result.question];
      expect(findForbiddenPhrase(all), label).toBeNull();
      expect(all.join(""), label).not.toMatch(/\{[a-z]+\}|undefined|null/);
      expect(all.join(""), label).not.toMatch(/是眼下的底色|是可以先动的一步|做的时候留意|这一层背景/);
      // v2.9：陪伴意图的行动不强制写字 / 记录；任何结果里，暂停决定或延后处理的行动都带边界
      if (intent === "companion") expect(result.action, label).not.toMatch(/写下|记下|记一句|写一句|只写|列出|列两栏|分两栏|清单|核对/);
      if (/不拍板|挪到明天|排到明天|明天再|明天同一时间|延期|延后|顺延/.test(result.action)) expect(result.action, label).toMatch(/期限|不紧急/);
      for (const card of result.cards) expect(result.overall, label).not.toContain(card.text);
      expect(result.interpretations[0], label).not.toBe(result.interpretations[1]);
      expect(result.question, label).toMatch(/？$/);
      expect(localContentVersion(request), label).toContain("local-v2");
      if (n % 7 === 0) expect(buildLocalReading(request), label).toEqual(result);

      const focus = selectLocalFocus(request) ?? "(无)";
      focusCounts[focus] = (focusCounts[focus] ?? 0) + 1;
      n++;
    }
    // 输出各主张的命中分布，方便看新批次有没有让某个主张“吃掉”所有组合
    console.log(`组合扫描 ${n} 个组合；主张命中：${JSON.stringify(focusCounts)}`);
    expect(n).toBeGreaterThan(0);
  });
});
