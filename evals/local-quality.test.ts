// 本地解读质量的自动部分（见 docs/prd-local-reading-quality-2026-10-10.md 的 LQ 验收）：
// 只验证稳定性、边界和“有理由的变化”；内容是否有观点、是否有用由人工审读判断（docs/local-reading-samples-*.md），这里不冒充。

import { describe, expect, it } from "vitest";
import { readingRequestSchema, readingResultSchema, resultMatchesDraw, type ReadingRequest } from "@/features/reading/contract";
import { findForbiddenPhrase } from "@/features/reading/guard";
import { createHash } from "node:crypto";
import { stableStringify } from "@/features/reading/backup";
import { buildLocalReading, localContentVersion, selectLocalFocus } from "@/features/reading/local";
import baseline from "./local-quality/baseline-v2.1.json";
import data from "./local-quality/cases.json";
import reserved from "./local-quality/reserved.json";

const make = (over: Partial<ReadingRequest> & Pick<ReadingRequest, "cards">): ReadingRequest =>
  readingRequestSchema.parse({ spreadId: "three-card", topic: "relationship", originalQuestion: "q", question: "合成问题", selfReading: "", ...over });

const samples = data.samples.map((s) => [s.id, make({ topic: s.topic as ReadingRequest["topic"], intent: s.intent as ReadingRequest["intent"], question: s.question, originalQuestion: s.question, cards: s.cards as ReadingRequest["cards"] })] as const);

const flat = (r: ReturnType<typeof buildLocalReading>) => [r.overall, ...r.cards.map((c) => c.text), ...r.interpretations, r.action, r.question].join("\n");
/** 不应在普通完成结果里反复出现的固定免责 / 退缩句（LQ06：能力说明集中在来源处，选择权靠按钮） */
/** AI 盲评指出的、凭空预设用户处境或情境的短语（不限于样本，扫描全部 v2 内容文本） */
const PRESUPPOSED = ["是眼下的底色", "是可以先动的一步", "想学的东西已经明确时", "你想了很久的计划", "当初答应是出于", "刚才那件小事", "卡住的是", "带着疲惫硬做判断", "已经开始漏球", "答应的事比能做的多", "你一直在回避", "你的状态正在上升"];
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
    expect(result.overall).toMatch(/这组牌(的重点是|值得先核对的是：).+。/);
    for (const phrase of BOILERPLATE) expect(flat(result), phrase).not.toContain(phrase);
  });

  it("两种读法有不同的适用条件；行动有对象和完成标准；追问是开放式", () => {
    expect(result.interpretations[0]).not.toBe(result.interpretations[1]);
    for (const r of result.interpretations) expect(r).toMatch(/时，|^如果/);
    expect(result.action.length).toBeGreaterThan(12);
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

  it("换首牌：此刻的牌与整体变化（未命中共同解释的组合里，首牌只影响现状与整体）", () => {
    const r = buildLocalReading(withCards([["the-hermit", false], ["three-of-pentacles", true], ["page-of-pentacles", false]]));
    expect(r.cards[0].text).not.toBe(r0.cards[0].text);
    expect(r.overall).not.toBe(r0.overall);
  });

  // 以下几条对照用一个没有命中共同解释的组合做基线（走按位置组织的路径），其余路径见“共同解释”一节
  const plainCards: [string, boolean][] = [["the-hermit", true], ["three-of-pentacles", true], ["six-of-swords", false]];
  const plain = buildLocalReading(withCards(plainCards));

  it("换阻碍牌：重点句、阻碍位说明、第一种读法都变", () => {
    const r = buildLocalReading(withCards([["the-hermit", true], ["four-of-swords", false], ["six-of-swords", false]]));
    expect(r.overall).not.toBe(plain.overall);
    expect(r.cards[1].text).not.toBe(plain.cards[1].text);
    expect(r.interpretations[0]).not.toBe(plain.interpretations[0]);
  });

  it("换末牌：第二种读法、行动、追问都变（未命中共同解释的组合）", () => {
    const r = buildLocalReading(withCards([["the-hermit", true], ["three-of-pentacles", true], ["knight-of-swords", true]]));
    expect(selectLocalFocus(withCards([["the-hermit", true], ["three-of-pentacles", true], ["knight-of-swords", true]]))).toBeNull();
    expect(r.interpretations[1]).not.toBe(plain.interpretations[1]);
    expect(r.action).not.toBe(plain.action);
    expect(r.question).not.toBe(plain.question);
  });

  it("换位置：同样三张牌换顺序，说明与重点随位置职责变化，牌 ID / 朝向仍精确对应位置", () => {
    const swapped = withCards([["three-of-pentacles", true], ["queen-of-wands", true], ["page-of-pentacles", false]]);
    const r = buildLocalReading(swapped);
    expect(resultMatchesDraw(r, swapped)).toBe(true);
    expect(r.overall).not.toBe(r0.overall);
    expect(r.cards[0].text).not.toBe(r0.cards[0].text);
  });

  it("翻正逆位：同一张阻碍牌正位 / 逆位给出不同的重点", () => {
    const up = buildLocalReading(withCards([["queen-of-wands", true], ["four-of-swords", false], ["page-of-pentacles", false]]));
    const rev = buildLocalReading(withCards([["queen-of-wands", true], ["four-of-swords", true], ["page-of-pentacles", false]]));
    expect(rev.overall).not.toBe(up.overall);
    expect(rev.interpretations[0]).not.toBe(up.interpretations[0]);
  });

  it("换主题：牌面解读与重点来自同一份内容，但行动里的对象随主题变化", () => {
    // “负担与过渡”的行动写了“{in}”，随主题换成对应的对象
    const cards = withCards([["two-of-pentacles", false], ["four-of-swords", false], ["six-of-swords", true]]).cards;
    const rel = buildLocalReading(make({ topic: "relationship", intent: "clarify", cards }));
    const job = buildLocalReading(make({ topic: "career", intent: "clarify", cards }));
    expect(rel.action).toContain("这段关系里");
    expect(job.action).toContain("这份工作里");
    // 首牌与末牌的说明不随主题变；阻碍位若该牌有主题变体则按主题改写（见下一条）
    expect(rel.cards[0]).toEqual(job.cards[0]);
    expect(rel.cards[2].text).toBe(job.cards[2].text);
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

describe("主题变体：个别牌在关系 / 去留主题下不套职场协作语境（AI 盲评指出的主题错配）", () => {
  const cards = [{ cardId: "the-hermit", position: 0, reversed: true }, { cardId: "three-of-pentacles", position: 1, reversed: true }, { cardId: "six-of-swords", position: 2, reversed: false }] as ReadingRequest["cards"];
  it("关系：重点说期待而不是分工；行动只涉及自己", () => {
    const r = buildLocalReading(make({ topic: "relationship", intent: "clarify", cards }));
    expect(r.overall).toContain("双方的期待有没有说清楚");
    expect(r.overall).not.toContain("分工");
    expect(r.action).not.toMatch(/联系|发消息|一起|对方回复/);
  });
  it("事业：仍按分工与约定", () => {
    const r = buildLocalReading(make({ topic: "career", intent: "clarify", cards }));
    expect(r.overall).toContain("约定有没有说清楚");
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

describe("v2 内容全文扫描", () => {
  it("没有已被评审指出的预设短语", async () => {
    const { LOCAL_V2 } = await import("@/features/reading/local");
    const text = JSON.stringify(LOCAL_V2.cards);
    for (const phrase of PRESUPPOSED) expect(text, phrase).not.toContain(phrase);
  });
});

describe("共同解释：先选主张，再渲染整体 / 读法 / 行动 / 追问（v2.2 的组合逻辑）", () => {
  const byId = (id: string) => data.samples.find((s) => s.id === id)!;
  const reqOf = (s: { topic: string; intent: string; cards: unknown }) => make({ topic: s.topic as ReadingRequest["topic"], intent: s.intent as ReadingRequest["intent"], cards: s.cards as ReadingRequest["cards"] });
  const run = (id: string) => buildLocalReading(reqOf(byId(id)));

  it("样本命中哪个主张是确定的；4 个样本仍没有对应主张，回到 v2.1 的按位置路径", () => {
    const focusOf = Object.fromEntries(data.samples.map((s) => [s.id, selectLocalFocus(reqOf(s))]));
    expect(focusOf).toEqual({
      "relationship-clarify-A": "invest-cooperate",
      "career-decide-B": "load-transition",
      "career-clarify": "small-trial",
      "career-companion": null, // v2.3：没有一张牌在讲过渡 / 收尾，不再套“负担与过渡”
      "relationship-decide": null,
      "relationship-companion": "settle-feelings",
      "self-clarify": null,
      "self-decide": "load-transition",
      "self-companion": "settle-feelings",
      "crossroads-clarify": "load-transition",
      "crossroads-decide": "small-trial",
      "crossroads-companion": "warm-juggle",
      "topicless-1": "warm-juggle",
      "topicless-2": "settle-feelings",
      "topicless-3": "small-trial",
      "topicless-4": null,
    });
  });

  it("命中主张时：整体先给主张，再说三张牌各自怎么支持 / 制约 / 转折；两条读法围绕同一个分支条件", () => {
    const r = run("career-clarify");
    expect(r.overall).toContain("这组牌的重点是把“做决定”和“做试验”分开");
    for (const name of ["权杖八（逆位）", "宝剑骑士（逆位）", "星币侍从（逆位）"]) expect(r.overall).toContain(name);
    expect(r.interpretations[0]).toMatch(/承诺/);
    expect(r.interpretations[1]).toMatch(/体验|试/);
    // 行动和追问都围绕“小试验”，不再要求另外的核对
    expect(r.action).toContain("到哪里停");
    expect(r.question).toContain("试验");
    expect(r.action).not.toContain("做的时候留意");
  });

  it("样本 3：既不叫停也不催促——没有“学过的内容”那类与主张冲突的读法", () => {
    const r = run("career-clarify");
    expect(r.interpretations.join("")).not.toMatch(/学过|学习|等一晚/);
  });

  it("样本 11：decide 的追问继续讨论选项，不再回到“最小的一次练习”", () => {
    const r = run("crossroads-decide");
    expect(r.question).not.toContain("最小的一次练习");
    expect(r.question).toMatch(/选项/);
  });

  it("陪伴：同一主张换成低负担动作，不强制写字 / 列清单 / 追加自查", () => {
    for (const id of ["topicless-1", "topicless-3", "crossroads-companion"]) {
      const r = run(id);
      expect(r.action, id).not.toMatch(/写下|记下|列出|留意|核对|清单/);
      expect(r.action.length).toBeGreaterThan(15);
    }
    // 未命中主张的陪伴样本（回到 v2.1 路径）也不再追加核对尾巴
    expect(run("self-companion").action).not.toContain("做的时候留意");
  });

  it("三种意图在同一主张下给出不同的取舍：clarify 做小试验，decide 比较选项，companion 轻量", () => {
    const cards = byId("career-clarify").cards as ReadingRequest["cards"];
    const by = (intent: "clarify" | "decide" | "companion") => buildLocalReading(make({ topic: "career", intent, cards }));
    const [c, d, p] = [by("clarify"), by("decide"), by("companion")];
    expect(new Set([c.action, d.action, p.action]).size).toBe(3);
    expect(new Set([c.question, d.question, p.question]).size).toBe(3);
    expect(c.interpretations).toEqual(d.interpretations); // 读法围绕同一个主张，不随意图改
    expect(d.action).toMatch(/每个选项/);
  });

  it("语义相反的首牌：把“热情”首牌换成“休息”后，主张消失，整体与行动都改变", () => {
    const base = byId("topicless-1");
    const swapped = { ...base, cards: base.cards.map((c, i) => (i === 0 ? { ...c, cardId: "four-of-swords" } : c)) };
    expect(selectLocalFocus(reqOf(base))).toBe("warm-juggle");
    // 剩下两张牌（兼顾、圣杯侍从）仍凑够两张贡献 → 主张保留，但首牌不再贡献，整体里的描述必须变化
    const a = buildLocalReading(reqOf(base));
    const b = buildLocalReading(reqOf(swapped));
    expect(b.overall).not.toBe(a.overall);
    expect(b.overall).toContain("带来「停下来恢复」这一层背景");
    expect(b.cards[0].text).not.toBe(a.cards[0].text);
  });

  it("末牌与主张相反时有转折：热情与兼顾的末牌换成“果断的骑士”，整体补一句转折，行动换成可以慢慢来的版本", () => {
    const base = byId("topicless-1");
    const swapped = { ...base, cards: base.cards.map((c, i) => (i === 2 ? { ...c, cardId: "knight-of-swords" } : c)) };
    const a = buildLocalReading(reqOf(base));
    const b = buildLocalReading(reqOf(swapped));
    expect(selectLocalFocus(reqOf(swapped))).toBe("warm-juggle"); // 主张仍成立：前两张牌支撑它
    expect(b.overall).toContain("末牌的节奏偏急");
    expect(b.action).not.toBe(a.action);
    expect(b.action).toMatch(/慢慢/);
    expect(b.cards[2].text).not.toBe(a.cards[2].text);
  });

  it("末牌转折不是万能：末牌换成与主张无关、也不相反的牌，行动仍由主张决定（已知局限，转折只覆盖编辑写明的相反标记）", () => {
    const base = byId("topicless-1");
    const swapped = { ...base, cards: base.cards.map((c, i) => (i === 2 ? { ...c, cardId: "the-hermit" } : c)) };
    expect(buildLocalReading(reqOf(swapped)).action).toBe(buildLocalReading(reqOf(base)).action);
  });

  it("关系主题下“投入与配合”的行动只涉及自己，不预设联系对方或一起完成", () => {
    const r = run("relationship-clarify-A");
    expect(r.overall).toContain("这组牌的重点是让双方的期待变得说得清楚");
    expect([r.overall, ...r.cards.map((c) => c.text), ...r.interpretations, r.question].join("")).not.toMatch(/任务|责任|分工|约定|追加投入|各自做什么/);
    expect(r.action).not.toMatch(/一起|联系|发消息|对方回复/);
    expect(r.action).toContain("只写你自己的部分");
  });

  it("“负担与过渡”不预设用户要走；decide 的行动在比较选项的代价", () => {
    const r = run("career-decide-B");
    expect(r.overall).toContain("先看清负担");
    expect([r.overall, ...r.interpretations, r.action, r.question].join("")).not.toMatch(/把“走”之前|想走却没走/);
    expect(r.action).toMatch(/每个选项/);
  });

  it("“安顿情绪”不预设有一件事让用户起伏，也不要求立刻判断", () => {
    for (const id of ["relationship-companion", "self-companion", "topicless-2"]) {
      const r = run(id);
      expect([r.action, r.question].join(""), id).not.toMatch(/刚才那件小事|今天让你起伏最大/);
    }
  });
});

describe("预先保留的 8 例新组合（未用于改稿）", () => {
  it.each(reserved.combos.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const req = make({ topic: c.topic as ReadingRequest["topic"], intent: c.intent as ReadingRequest["intent"], cards: c.cards as ReadingRequest["cards"] });
    expect(selectLocalFocus(req)).toBe(c.expectedFocus);
    const r = buildLocalReading(req);
    expect(readingResultSchema.parse(r).source).toBe("local");
    expect(resultMatchesDraw(r, req)).toBe(true);
    expect(findForbiddenPhrase([flat(r)])).toBeNull();
    if (c.intent === "companion") expect(r.action).not.toContain("做的时候留意");
  });
});

describe("冻结的 v2.1 基线（候选 vs 基线，不再对 v1）", () => {
  const sha = (value: unknown) => createHash("sha256").update(stableStringify(value)).digest("hex");

  it("基线文件完整：输入与冻结样本一致，每条输出的摘要值对得上", () => {
    expect(baseline.commit).toBe("00364cb");
    expect(baseline.samples.map((s) => s.id)).toEqual(data.samples.map((s) => s.id));
    for (const s of baseline.samples) expect(sha(s.output), s.id).toBe(s.sha256);
  });

  it("逐例比较：命中共同解释的样本整体 / 读法 / 行动 / 追问都与 v2.1 不同；未命中的与 v2.1 的差异只来自“陪伴不再追加核对”", () => {
    const changed: string[] = [];
    for (const s of baseline.samples) {
      const req = readingRequestSchema.parse(s.request);
      const now = buildLocalReading(req);
      const focus = selectLocalFocus(req);
      if (focus) {
        changed.push(`${s.id}:${focus}`);
        expect(now.overall, s.id).not.toBe(s.output.overall);
        expect(now.action, s.id).not.toBe(s.output.action);
        expect(now.question, s.id).not.toBe(s.output.question);
        expect(now.interpretations, s.id).not.toEqual(s.output.interpretations);
      } else {
        // 未命中主张的样本回到按位置的路径：v2.4 去掉了“是眼下的底色 / 是可以先动的一步”模板句和“做的时候留意”尾巴，牌面说明保持
        expect(now.cards, s.id).toEqual(s.output.cards);
        expect(now.overall, s.id).not.toContain("是眼下的底色");
        expect(now.action, s.id).not.toContain("做的时候留意");
      }
    }
    // 5 个主张命中 12 个样本；其余 4 个仍走按位置的路径
    expect(changed).toHaveLength(12);
    expect(data.samples.length - changed.length).toBe(4);
  });
});

describe("v2.3：口径与适用范围（针对第三轮风险审查）", () => {
  it("主张里每张牌的关系句都带“可能 / 也许 / 或许”，不把牌义写成用户的状态", async () => {
    const { LOCAL_V2 } = await import("@/features/reading/local");
    for (const focus of LOCAL_V2.focuses) {
      for (const [tag, role] of Object.entries(focus.roles)) {
        expect(role.relation, `${focus.id}/${tag}`).toMatch(/^(可能|也许|或许)/);
        // 条件句（以“如果”开头）里的比较不算断言；其余写法里不得出现把牌义当成用户状态的措辞
        if (!role.detail.startsWith("如果")) expect(`${role.relation}${role.detail}`, `${focus.id}/${tag}`).not.toMatch(/说明你|说明情绪|指出承诺|给出一个正在|比继续自责|比继续硬撑更有用|(?<!是否)已经偏(多|重)/);
      }
    }
  });

  it("命中主张的样本，整体里的关系句都有“可能”", () => {
    for (const s of data.samples) {
      const req = make({ topic: s.topic as ReadingRequest["topic"], intent: s.intent as ReadingRequest["intent"], cards: s.cards as ReadingRequest["cards"] });
      if (!selectLocalFocus(req)) continue;
      const hits = buildLocalReading(req).overall.match(/可能/g) ?? [];
      expect(hits.length, s.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("凡是建议延期 / 暂放 / 挪到明天的行动或读法，都带“不紧急”或“有期限的事以期限为准”", async () => {
    const { LOCAL_V2 } = await import("@/features/reading/local");
    const delays = /延期|延后|暂放|先放着|挪到明天|明天再|明天同一时间/;
    for (const focus of LOCAL_V2.focuses) {
      const texts = [...Object.values(focus.actions), ...focus.branches, ...Object.values(focus.topicActions ?? {}).flatMap((a) => Object.values(a ?? {})), ...(focus.turns ?? []).flatMap((t) => Object.values(t.actions ?? {}))];
      for (const t of texts) if (delays.test(t)) expect(t, `${focus.id}: ${t}`).toMatch(/期限|不紧急/);
    }
  });

  it("v2.1 路径（逐牌内容）里的延期 / 顺延 / 留到明天，同样带“不紧急”或“有期限的事以期限为准”", async () => {
    const { LOCAL_V2 } = await import("@/features/reading/local");
    const delays = /延期|延后|顺延|暂放|先放着|挪到明天|明天再|明天同一时间|其余.*明天|留到明天/;
    for (const [id, card] of Object.entries(LOCAL_V2.cards)) {
      for (const side of [card.upright, card.reversed]) {
        for (const t of [side.obstacle.check, side.next.check, ...Object.values(side.next.actions)]) if (delays.test(t)) expect(t, id).toMatch(/期限|不紧急/);
      }
    }
  });

  it("“负担与过渡”只在有一张牌真的在讲过渡 / 收尾时命中，且读法不预设用户要开始变动", () => {
    const withoutTransition = make({ topic: "career", intent: "companion", cards: [{ cardId: "queen-of-wands", position: 0, reversed: true }, { cardId: "four-of-swords", position: 1, reversed: false }, { cardId: "two-of-pentacles", position: 2, reversed: true }] });
    expect(selectLocalFocus(withoutTransition)).not.toBe("load-transition");
    const withTransition = buildLocalReading(make({ topic: "career", intent: "clarify", cards: [{ cardId: "two-of-pentacles", position: 0, reversed: false }, { cardId: "four-of-swords", position: 1, reversed: false }, { cardId: "six-of-swords", position: 2, reversed: true }] }));
    for (const r of withTransition.interpretations) expect(r).toMatch(/^如果正在考虑一个变动/);
  });
});

describe("v2.4：主题变体、雷同与逐牌差异", () => {
  const run = (id: string) => {
    const s = data.samples.find((x) => x.id === id)!;
    return buildLocalReading(make({ topic: s.topic as ReadingRequest["topic"], intent: s.intent as ReadingRequest["intent"], cards: s.cards as ReadingRequest["cards"] }));
  };

  it("样本 8（自我 · decide）与样本 2（事业 · decide）不再逐字相同：读法、行动、追问按主题改写", () => {
    const a = run("career-decide-B");
    const b = run("self-decide");
    expect(b.interpretations).not.toEqual(a.interpretations);
    expect(b.action).not.toBe(a.action);
    expect(b.question).not.toBe(a.question);
    expect(b.overall).toContain("先看清现有的承诺");
    expect(b.overall).not.toContain("过渡"); // 自我主题不再套“过渡”
    expect(a.overall).toContain("过渡"); // 事业主题仍是默认说法
  });

  it("“安顿与恢复”的三个陪伴 / 澄清样本：行动与追问跟着末牌变，死神（逆位）进入读法", () => {
    const [six, nine, fourteen] = [run("relationship-companion"), run("self-companion"), run("topicless-2")];
    expect(new Set([six.action, nine.action, fourteen.action]).size).toBe(3);
    expect(new Set([six.question, nine.question, fourteen.question]).size).toBe(3);
    expect(fourteen.overall).toContain("死神（逆位）可能在提示有一件该收尾的事还拖着");
  });

  it("没有具体问题（陪伴）时，“节奏与试验”的读法不再预设“难以撤回的承诺”", () => {
    const r = run("topicless-3");
    expect(r.interpretations.join("")).not.toContain("难以撤回");
    expect(r.interpretations[1]).toContain("五分钟");
  });

  it("去留主题的“负担与过渡”读法讲两个选项的消耗，不预设“现有负担已经占满”", () => {
    const r = run("crossroads-clarify");
    expect(r.interpretations.join("")).not.toContain("现有负担已经占满");
    expect(r.interpretations[0]).toMatch(/两个选项/);
    expect(r.action.length).toBeLessThan(80);
  });
});
