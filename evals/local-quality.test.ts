// 本地解读质量的自动部分（见 docs/prd-local-reading-quality-2026-10-10.md 的 LQ 验收）：
// 只验证稳定性、边界和“有理由的变化”；内容是否有观点、是否有用由人工审读判断（docs/local-reading-samples-*.md），这里不冒充。

import { describe, expect, it } from "vitest";
import { readingRequestSchema, readingResultSchema, resultMatchesDraw, type ReadingRequest } from "@/features/reading/contract";
import { findForbiddenPhrase } from "@/features/reading/guard";
import { buildLocalReading, localContentVersion } from "@/features/reading/local";
import data from "./local-quality/cases.json";

const make = (over: Partial<ReadingRequest> & Pick<ReadingRequest, "cards">): ReadingRequest =>
  readingRequestSchema.parse({ spreadId: "three-card", topic: "relationship", originalQuestion: "q", question: "合成问题", selfReading: "", ...over });

const samples = data.samples.map((s) => [s.id, make({ topic: s.topic as ReadingRequest["topic"], intent: s.intent as ReadingRequest["intent"], question: s.question, originalQuestion: s.question, cards: s.cards as ReadingRequest["cards"] })] as const);

const flat = (r: ReturnType<typeof buildLocalReading>) => [r.overall, ...r.cards.map((c) => c.text), ...r.interpretations, r.action, r.question].join("\n");
/** 不应在普通完成结果里反复出现的固定免责 / 退缩句（LQ06：能力说明集中在来源处，选择权靠按钮） */
const BOILERPLATE = ["不是答案", "不替你做决定", "不替你决定", "只是一个建议", "不用今天决定", "不必告诉任何人"];

describe.each(samples)("本地解读样本 %s", (_id, request) => {
  const result = buildLocalReading(request);

  it("走 v2 内容，通过 schema / 牌面一致 / 内容红线，输出稳定", () => {
    expect(localContentVersion(request)).toContain("local-v2");
    expect(readingResultSchema.parse(result).source).toBe("local");
    expect(resultMatchesDraw(result, request)).toBe(true);
    expect(findForbiddenPhrase([flat(result)])).toBeNull();
    expect(buildLocalReading(request)).toEqual(result);
  });

  it("首段先给观点（有“重点”句），不是牌名目录；没有固定免责套话", () => {
    expect(result.overall).toMatch(/这组牌的重点是.+。/);
    for (const phrase of BOILERPLATE) expect(flat(result), phrase).not.toContain(phrase);
  });

  it("两种读法有不同的适用条件；行动有对象和完成标准；追问是开放式", () => {
    expect(result.interpretations[0]).not.toBe(result.interpretations[1]);
    for (const r of result.interpretations) expect(r).toMatch(/时，/);
    expect(result.action.length).toBeGreaterThan(20);
    expect(result.question).toMatch(/？$/);
    expect(result.question).not.toMatch(/吗？$/);
  });
});

describe("定向对照：换一个输入，结果有理由地变化（LQ02 / LQ04 / LQ09）", () => {
  const A = (data.samples.find((s) => s.id === "relationship-clarify-A")!);
  const base = make({ topic: "relationship", intent: "clarify", cards: A.cards as ReadingRequest["cards"] });
  const withCards = (cards: [string, boolean][], over: Partial<ReadingRequest> = {}) =>
    make({ topic: "relationship", intent: "clarify", ...over, cards: cards.map(([cardId, reversed], position) => ({ cardId, position, reversed })) as ReadingRequest["cards"] });
  const r0 = buildLocalReading(base);

  it("换首牌：此刻的牌与整体变化，读法与行动不变（首牌只负责现状，不影响核对路径）", () => {
    const r = buildLocalReading(withCards([["the-hermit", false], ["three-of-pentacles", true], ["page-of-pentacles", false]]));
    expect(r.cards[0].text).not.toBe(r0.cards[0].text);
    expect(r.overall).not.toBe(r0.overall);
    expect(r.interpretations).toEqual(r0.interpretations);
  });

  it("换阻碍牌：重点句、阻碍位说明、第一种读法都变", () => {
    const r = buildLocalReading(withCards([["queen-of-wands", true], ["four-of-swords", false], ["page-of-pentacles", false]]));
    expect(r.overall).not.toBe(r0.overall);
    expect(r.cards[1].text).not.toBe(r0.cards[1].text);
    expect(r.interpretations[0]).not.toBe(r0.interpretations[0]);
    expect(r.interpretations[1]).toBe(r0.interpretations[1]);
  });

  it("换末牌：第二种读法、行动、追问都变", () => {
    const r = buildLocalReading(withCards([["queen-of-wands", true], ["three-of-pentacles", true], ["knight-of-swords", false]]));
    expect(r.interpretations[1]).not.toBe(r0.interpretations[1]);
    expect(r.action).not.toBe(r0.action);
    expect(r.question).not.toBe(r0.question);
  });

  it("换位置：同样三张牌换顺序，说明与重点随位置职责变化，牌 ID / 朝向仍精确对应位置", () => {
    const swapped = withCards([["three-of-pentacles", true], ["queen-of-wands", true], ["page-of-pentacles", false]]);
    const r = buildLocalReading(swapped);
    expect(resultMatchesDraw(r, swapped)).toBe(true);
    expect(r.overall).not.toBe(r0.overall);
    expect(r.cards[0].text).not.toBe(r0.cards[0].text);
  });

  it("翻正逆位：同一张阻碍牌正位 / 逆位给出不同的重点", () => {
    const r = buildLocalReading(withCards([["queen-of-wands", true], ["three-of-pentacles", false], ["page-of-pentacles", false]]));
    expect(r.overall).not.toBe(r0.overall);
    expect(r.interpretations[0]).not.toBe(r0.interpretations[0]);
  });

  it("换主题：牌面解读与重点来自同一份内容，但行动里的对象随主题变化", () => {
    // 末牌隐士的行动写了“{in}”，随主题换成对应的对象
    const cards = withCards([["queen-of-wands", true], ["three-of-pentacles", true], ["the-hermit", false]]).cards;
    const rel = buildLocalReading(make({ topic: "relationship", intent: "clarify", cards }));
    const job = buildLocalReading(make({ topic: "career", intent: "clarify", cards }));
    expect(rel.action).toContain("这段关系里");
    expect(job.action).toContain("这份工作里");
    expect(rel.cards).toEqual(job.cards);
  });

  it("换意图：行动与整体结尾变化，牌面说明不变；decide / companion 的行动不是同一句", () => {
    const by = (intent: "clarify" | "decide" | "companion") => buildLocalReading(make({ topic: "relationship", intent, cards: A.cards as ReadingRequest["cards"] }));
    const [c, d, p] = [by("clarify"), by("decide"), by("companion")];
    expect(new Set([c.action, d.action, p.action]).size).toBe(3);
    expect(new Set([c.overall, d.overall, p.overall]).size).toBe(3);
    expect(d.cards).toEqual(c.cards);
    expect(p.cards).toEqual(c.cards);
  });

  it("改问题 / 自解：本地规则不读问题正文，结果与问题无关；自解只作为用户原话前置，不改其余字段", () => {
    const other = buildLocalReading(make({ topic: "relationship", intent: "clarify", question: "完全不同的问题", originalQuestion: "完全不同的问题", cards: A.cards as ReadingRequest["cards"] }));
    expect(other).toEqual(r0);
    const withSelf = buildLocalReading(make({ topic: "relationship", intent: "clarify", selfReading: "合成自解", cards: A.cards as ReadingRequest["cards"] }));
    expect(withSelf.overall).toContain("合成自解");
    expect({ ...withSelf, overall: "" }).toEqual({ ...r0, overall: "" });
  });
});

describe("回退：任一张牌没有 v2 内容，整体回退到 v1 模板，结果仍通过硬检查", () => {
  it("样稿牌 + 未写内容的牌", () => {
    const req = make({ cards: [{ cardId: "the-hermit", position: 0, reversed: false }, { cardId: "the-fool", position: 1, reversed: false }, { cardId: "page-of-pentacles", position: 2, reversed: false }] });
    expect(localContentVersion(req)).not.toContain("local-v2");
    const r = buildLocalReading(req);
    expect(readingResultSchema.parse(r).source).toBe("local");
    expect(resultMatchesDraw(r, req)).toBe(true);
    expect(r).toEqual(buildLocalReading(req, { legacy: true }));
  });
});
