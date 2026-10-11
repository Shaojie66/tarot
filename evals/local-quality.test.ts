// 本地解读质量的自动部分（见 docs/prd-local-reading-quality-2026-10-10.md 的 LQ 验收）：
// 只验证稳定性、边界和“有理由的变化”；内容是否有观点、是否有用由人工审读判断（docs/local-reading-samples-*.md），这里不冒充。

import { describe, expect, it } from "vitest";
import { readingRequestSchema, readingResultSchema, resultMatchesDraw, type ReadingRequest } from "@/features/reading/contract";
import { findForbiddenPhrase } from "@/features/reading/guard";
import { createHash } from "node:crypto";
import { stableStringify } from "@/features/reading/backup";
import { LOCAL_V2, buildLocalReading, localContentVersion, selectLocalFocus } from "@/features/reading/local";
import { TOPICS } from "@/features/cards/schema";
import baseline from "./local-quality/baseline-v2.1.json";
import data from "./local-quality/cases.json";
import reserved from "./local-quality/reserved.json";

const make = (over: Partial<ReadingRequest> & Pick<ReadingRequest, "cards">): ReadingRequest =>
  readingRequestSchema.parse({ spreadId: "three-card", topic: "relationship", originalQuestion: "q", question: "合成问题", selfReading: "", ...over });

const samples = data.samples.map((s) => [s.id, make({ topic: s.topic as ReadingRequest["topic"], intent: s.intent as ReadingRequest["intent"], question: s.question, originalQuestion: s.question, cards: s.cards as ReadingRequest["cards"] })] as const);

const flat = (r: ReturnType<typeof buildLocalReading>) => [r.overall, ...r.cards.map((c) => c.text), ...r.interpretations, r.action, r.question].join("\n");
/** 不应在普通完成结果里反复出现的固定免责 / 退缩句（LQ06：能力说明集中在来源处，选择权靠按钮） */
/** AI 盲评指出的、凭空预设用户处境或情境的短语（不限于样本，扫描全部 v2 内容文本） */
const PRESUPPOSED = ["是眼下的底色", "是可以先动的一步", "想学的东西已经明确时", "你想了很久的计划", "当初答应是出于", "刚才那件小事", "卡住的是", "带着疲惫硬做判断", "已经开始漏球", "答应的事比能做的多", "你一直在回避", "你的状态正在上升", "先承认", "最近三次", "这次变动里", "过渡期里", "省下的半小时", "学过的东西", "让“离开”更近", "今天最想快点解决的事"];
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
    expect(job.action).toContain("工作里");
    // 首牌的说明不随主题变；v2.9 起关系主题下“负担与过渡”有自己的变体：末牌（宝剑六逆位）讲“调整迟迟没开始”，不套去留的“过渡 / 脚步”
    expect(rel.cards[0]).toEqual(job.cards[0]);
    expect(rel.cards[2].text).toContain("这段关系里有个调整迟迟没开始");
    expect(job.cards[2].text).not.toContain("这段关系");
    expect(rel.overall).not.toMatch(/过渡|拖住脚步/);
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

  it("样本命中哪个主张是确定的；3 个样本仍没有对应主张，回到按位置路径（v2.10 的后备主张接住了另外 2 个）", () => {
    const focusOf = Object.fromEntries(data.samples.map((s) => [s.id, selectLocalFocus(reqOf(s))]));
    expect(focusOf).toEqual({
      "relationship-clarify-A": "invest-cooperate",
      "career-decide-B": "load-transition",
      "career-clarify": "small-trial",
      "career-companion": null, // v2.3：没有一张牌在讲过渡 / 收尾，不再套“负担与过渡”
      "relationship-decide": null,
      "relationship-companion": "settle-feelings",
      "self-clarify": "inner-first", // v2.10：隐士在阻碍位，原有主张都不命中 → 后备主张“先听自己”
      "self-decide": "load-transition",
      "self-companion": "settle-feelings",
      "crossroads-clarify": "load-transition",
      "crossroads-decide": "small-trial",
      "crossroads-companion": "warm-juggle",
      "topicless-1": "warm-juggle",
      "topicless-2": "settle-feelings",
      "topicless-3": "inner-first", // v2.5：陪伴时“做决定与做试验”不适用；v2.10：隐士在首位 → 后备主张“先听自己”
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
    for (const id of ["topicless-1", "crossroads-companion"]) {
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
    // v2.9：没有贡献标记的牌不再只是“带来「……」这一层背景”，而是说出它对主张的作用（support），没写就用它的一句话要点
    expect(b.overall).toContain("宝剑四可能在提示靠近喜欢的事之前，可以先停一停");
    expect(b.overall).not.toContain("这一层背景");
    expect(b.cards[0].text).not.toBe(a.cards[0].text);
  });

  it("末牌与主张相反时有转折，而且转折说得出理由：果断的骑士 → 把劲头用在有停点的小试探上；冲得太快的骑士 → 放到能慢慢来的小事上", () => {
    const base = byId("topicless-1");
    const withLast = (reversed: boolean) => ({ ...base, cards: base.cards.map((c, i) => (i === 2 ? { ...c, cardId: "knight-of-swords", reversed } : c)) });
    const a = buildLocalReading(reqOf(base));
    const [decisive, rushed] = [buildLocalReading(reqOf(withLast(false))), buildLocalReading(reqOf(withLast(true)))];
    expect(selectLocalFocus(reqOf(withLast(false)))).toBe("warm-juggle"); // 主张仍成立：前两张牌支撑它
    // v2.9：正位的骑士不是“偏急”，是推进的劲头——转折要解释它怎么和“收拢热情”接上，而不是一律叫人慢下来
    expect(decisive.overall).toContain("最后一张牌带着推进的劲头");
    expect(decisive.action).toMatch(/停|到点/);
    expect(rushed.overall).toContain("最后一张牌提醒速度可能压过判断");
    expect(rushed.action).toMatch(/慢慢/);
    for (const b of [decisive, rushed]) {
      expect(b.action).not.toBe(a.action);
      expect(b.cards[2].text).not.toBe(a.cards[2].text);
    }
    expect(decisive.overall).not.toBe(rushed.overall);
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

describe("预先保留的组合（8 例 + v2.10 写内容之前追加的 12 例；未用于改稿）", () => {
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
        // 牌的 ID / 位置 / 朝向不变；说明文字可以因为主题变体（如关系里的宝剑六）而改变
        expect(now.cards.map((c) => [c.cardId, c.position, c.reversed]), s.id).toEqual(s.output.cards.map((c) => [c.cardId, c.position, c.reversed]));
        expect(now.overall, s.id).not.toContain("是眼下的底色");
        expect(now.action, s.id).not.toContain("做的时候留意");
      }
    }
    // 原有 5 个主张命中 11 个样本；v2.10 的后备主张再接住 2 个；其余 3 个仍走按位置的路径
    expect(changed).toHaveLength(13);
    expect(changed.filter((x) => /inner-first|rebuild|momentum-check/.test(x))).toHaveLength(2);
    expect(data.samples.length - changed.length).toBe(3);
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

  it("陪伴意图下“节奏与试验”不适用：此刻（无问题）的样本不套“做决定与做试验”，也不预设“做决定”（v2.10 起由后备主张“先听自己”接住）", () => {
    const sample = data.samples.find((x) => x.id === "topicless-3")!;
    const req = make({ topic: sample.topic as ReadingRequest["topic"], intent: sample.intent as ReadingRequest["intent"], cards: sample.cards as ReadingRequest["cards"] });
    expect(selectLocalFocus(req)).not.toBe("small-trial");
    expect(selectLocalFocus(req)).toBe("inner-first");
    const r = run("topicless-3");
    expect(r.overall + r.interpretations.join("")).not.toMatch(/做决定|难以撤回/);
    // 陪伴：读法与行动都不布置书写
    expect(r.interpretations.join("") + r.action).not.toMatch(/写下|写出|列出|清单|两栏/);
  });

  it("热情与兼顾的陪伴按末牌分：末牌是“热度”和“小喜欢”时行动与追问不同（样本 12 / 13 不再逐字相同）", () => {
    const [a, b] = [run("crossroads-companion"), run("topicless-1")];
    expect(a.action).not.toBe(b.action);
    expect(a.question).not.toBe(b.question);
  });

  it("安顿与恢复：读法也跟着末牌变，三个样本两条读法互不相同", () => {
    const three = [run("relationship-companion"), run("self-companion"), run("topicless-2")].map((r) => r.interpretations.join("|"));
    expect(new Set(three).size).toBe(3);
  });


  it("去留主题的“负担与过渡”读法讲两个选项的消耗，不预设“现有负担已经占满”", () => {
    const r = run("crossroads-clarify");
    expect(r.interpretations.join("")).not.toContain("现有负担已经占满");
    expect(r.interpretations[0]).toMatch(/两个选项/);
    expect(r.action.length).toBeLessThan(80);
  });
});

describe("v2.5：延后类措辞的全文扫描（含牌说明、变体、转折）", () => {
  it("focus 里任何字符串，只要建议先不处理 / 延后 / 等稳下来 / 明天再，就带“不紧急”或“有期限的事以期限为准”", async () => {
    const { LOCAL_V2 } = await import("@/features/reading/local");
    const delays = /先别急着处理|不必急着去碰|等稳下来|等情绪缓一点再|暂放|延期|延后|顺延|挪到明天|明天再|明天同一时间|留到明天|其余.*明天/;
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(LOCAL_V2.focuses);
    for (const t of strings) if (delays.test(t)) expect(t).toMatch(/期限|不紧急/);
  });

  it("未命中主张的整体用“一句话要点”综合三张牌：不是标签句、不重复开头、不抄逐牌说明、也不是没有内容的指引", () => {
    for (const id of ["relationship-decide", "self-clarify", "topicless-4", "career-companion"]) {
      const s = data.samples.find((x) => x.id === id)!;
      const r = buildLocalReading(make({ topic: s.topic as ReadingRequest["topic"], intent: s.intent as ReadingRequest["intent"], cards: s.cards as ReadingRequest["cards"] }));
      expect(r.overall, id).not.toContain("这组牌里出现了");
      for (const c of r.cards) expect(r.overall, `${id}/${c.cardId}`).not.toContain(c.text);
      expect(r.overall, id).toMatch(/可能/);
      const focus = r.overall.match(/值得先核对的是：([^。]+)。/)?.[1];
      if (focus) expect(r.overall.split(focus).length - 1, id).toBe(1);
    }
  });
});

describe("v2.6：陪伴语气、主题体现与期限句的位置", () => {
  const run = (id: string) => {
    const s = data.samples.find((x) => x.id === id)!;
    return buildLocalReading(make({ topic: s.topic as ReadingRequest["topic"], intent: s.intent as ReadingRequest["intent"], cards: s.cards as ReadingRequest["cards"] }));
  };

  it("陪伴行动只在真的会“延后”什么时才带期限句：喝水 / 慢呼吸这类行动不带", () => {
    for (const id of ["self-companion", "relationship-companion"]) expect(run(id).action, id).not.toContain("期限");
  });

  it("关系主题的陪伴：样本 6 里看得出是关于这段关系（整体、行动、追问都点到）", () => {
    const r = run("relationship-companion");
    expect(r.overall).toContain("这段关系");
    expect(r.action).toContain("这段关系");
    expect(r.question).toContain("这段关系");
  });

  it("去留主题的陪伴：样本 12 点到两个选项，而不只是“小喜欢”", () => {
    const r = run("crossroads-companion");
    expect(r.overall).toContain("两个选项");
    expect(r.question).toContain("两个选项");
  });

  it("死神（逆位）一行不再塞三层意思：只有“稳住自己”和“可撤回的小改动”", () => {
    const r = run("topicless-2");
    const death = r.cards[2].text;
    expect(death).not.toContain("期限");
    expect(death.length).toBeLessThan(60);
  });
});

describe("v2.7：未命中主张的整体用一句话要点综合三张牌；热情与兼顾的读法不再雷同", () => {
  const run = (id: string) => {
    const s = data.samples.find((x) => x.id === id)!;
    return buildLocalReading(make({ topic: s.topic as ReadingRequest["topic"], intent: s.intent as ReadingRequest["intent"], cards: s.cards as ReadingRequest["cards"] }));
  };

  it("每个朝向都有以“可能”开头的一句话要点，且与它自己的逐牌说明不是同一句", async () => {
    const { LOCAL_V2 } = await import("@/features/reading/local");
    for (const [id, card] of Object.entries(LOCAL_V2.cards)) {
      for (const side of [card.upright, card.reversed]) {
        expect(side.oneLine, id).toMatch(/^可能/);
        for (const t of [side.situation, side.obstacle.text, side.next.text]) expect(t, id).not.toContain(side.oneLine.replace(/^可能(在)?/, ""));
      }
    }
  });

  it("未命中主张的样本：整体里三张牌的名字都出现，各带一句“可能……”，没有空指引", () => {
    for (const id of ["relationship-decide", "self-clarify", "topicless-4", "career-companion"]) {
      const r = run(id);
      expect((r.overall.match(/可能/g) ?? []).length, id).toBeGreaterThanOrEqual(3);
      expect(r.overall, id).not.toMatch(/下面两条读法|挑一条读法/);
    }
  });

  it("热情与兼顾：末牌是“热度”和“小喜欢”时两条读法不同（样本 12 / 13）", () => {
    expect(run("crossroads-companion").interpretations).not.toEqual(run("topicless-1").interpretations);
  });
});

describe("v2.9：按 AI 编辑审读打回后的全文扫描（预设、延后边界、陪伴负担、下一步方向、主题变体）", () => {
  type Side = (typeof LOCAL_V2.cards)[keyof typeof LOCAL_V2.cards]["upright"];
  const sides = Object.entries(LOCAL_V2.cards).flatMap(([id, card]) => ([["upright", card!.upright], ["reversed", card!.reversed]] as const).map(([o, side]) => [`${id}.${o}`, side as Side] as const));
  /** 每个朝向在每个主题下实际使用的内容（主题变体覆盖默认） */
  const resolved = sides.flatMap(([name, side]) =>
    TOPICS.map((topic) => {
      const v = side.byTopic?.[topic];
      return { name: `${name}@${topic}`, oneLine: v?.oneLine ?? side.oneLine, situation: v?.situation ?? side.situation, obstacle: { ...side.obstacle, ...v?.obstacle }, next: { ...side.next, ...v?.next, actions: { ...side.next.actions, ...v?.next?.actions } } };
    }),
  );
  const strings = (value: unknown, path = ""): [string, string][] =>
    typeof value === "string" ? [[path, value]] : Array.isArray(value) ? value.flatMap((v, i) => strings(v, `${path}[${i}]`)) : value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k)) : [];
  const allStrings = strings({ cards: LOCAL_V2.cards, focuses: LOCAL_V2.focuses, closing: LOCAL_V2.closing });
  const req = (topic: ReadingRequest["topic"], intent: NonNullable<ReadingRequest["intent"]>, cards: [string, boolean][]) =>
    make({ topic, intent, cards: cards.map(([cardId, reversed], position) => ({ cardId, position, reversed })) as ReadingRequest["cards"] });

  it("延后边界覆盖全部字符串：让人暂停决定 / 延后处理的句子，同一句里有“不紧急”或期限（不只查行动和读法）", () => {
    const delays = /不拍板|先于决定|再做决定|再去处理|再处理其|不用做任何决定|待查清单|先等一晚|休息之后再|排[在到].{0,6}之后|延期|延后|顺延|暂放|先放着|挪到明天|排到明天|明天再|明天同一时间|留到明天|其余.*明天|先别急着处理|不必急着去碰|等稳下来|等情绪缓一点再/;
    for (const [path, text] of allStrings) if (delays.test(text)) expect(text, path).toMatch(/期限|不紧急/);
  });

  it("陪伴行动不强制写字 / 记录 / 列清单 / 核对（逐牌、主题变体、主张、转折、末牌变体全部扫描）", () => {
    const forced = /写下|记下|记一句|写一句|只写|列出|列两栏|分两栏|清单|核对/;
    const companions = allStrings.filter(([path]) => /actions\.companion$|topicActions\.[a-z]+\.companion$/.test(path));
    expect(companions.length).toBeGreaterThan(40);
    for (const [path, text] of companions) expect(text, path).not.toMatch(forced);
    // 陪伴意图下的读法也不要求分析（安顿与恢复的陪伴读法）
    for (const focus of LOCAL_V2.focuses) for (const text of focus.intentBranches?.companion ?? []) expect(text, focus.id).not.toMatch(forced);
  });

  it("读法在三种意图下共用（含陪伴）：逐牌的读法只给条件和方向，不要求写 / 列；主张在陪伴时实际用到的读法同样如此", () => {
    const forced = /写下|写出|写成|写清|列出|记下|清单|两栏/;
    for (const r of resolved) for (const check of [r.obstacle.check, r.next.check]) expect(check, r.name).not.toMatch(forced);
    for (const focus of LOCAL_V2.focuses) {
      if (focus.excludeIntents?.includes("companion")) continue;
      const used = [...(focus.intentBranches?.companion ?? focus.branches), ...Object.values(focus.nextVariants ?? {}).flatMap((v) => v.branches ?? [])];
      for (const text of used) expect(text, focus.id).not.toMatch(forced);
    }
  });

  it("追问是开放式、不预设：全部问句以“？”结尾，不以“吗 / 是不是 / 要不要”收尾，不含已知的预设短语", () => {
    const questions = allStrings.filter(([path]) => /question$|questions\.[a-z]+$/.test(path));
    expect(questions.length).toBeGreaterThan(50);
    for (const [path, text] of questions) {
      expect(text, path).toMatch(/？$/);
      expect(text, path).not.toMatch(/(吗|是不是|要不要)？$/);
    }
    const everything = allStrings.map(([, t]) => t).join("\n");
    for (const phrase of PRESUPPOSED) expect(everything, phrase).not.toContain(phrase);
  });

  it("每个朝向在每个主题下：下一步方向（aim）是短语、不抄逐牌说明；读法是条件句；一句话要点以“可能”开头且不抄说明", () => {
    for (const r of resolved) {
      expect(r.next.aim.length, r.name).toBeGreaterThanOrEqual(4);
      expect(r.next.aim.length, r.name).toBeLessThanOrEqual(30);
      expect(r.next.aim, r.name).not.toMatch(/[。？！：]/);
      expect(r.next.text, r.name).not.toContain(r.next.aim);
      for (const check of [r.obstacle.check, r.next.check]) expect(check, r.name).toMatch(/时，|^如果/);
      expect(r.oneLine, r.name).toMatch(/^可能/);
      for (const t of [r.situation, r.obstacle.text, r.next.text]) expect(t, r.name).not.toContain(r.oneLine.replace(/^可能(在)?/, ""));
      expect(r.next.question, r.name).toMatch(/？$/);
    }
  });

  it("主张里的衔接（support）以“可能”开头，且只给不参与选主张的标记写", () => {
    for (const focus of LOCAL_V2.focuses) {
      for (const [tag, s] of Object.entries(focus.support ?? {})) {
        expect(s.relation, `${focus.id}/${tag}`).toMatch(/^(可能|也许|或许)/);
        expect(focus.weights[tag], `${focus.id}/${tag} 已有权重，应写进 roles`).toBeUndefined();
      }
    }
  });

  it("按位置路径的整体是两拍：先核对阻碍牌的点，再交代末牌的方向；三种意图的收尾不同", () => {
    // 星币二 / 隐士（逆位）/ 宝剑六（逆位）：没有锚牌，原有主张也不命中，仍走按位置路径
    const cards: [string, boolean][] = [["two-of-pentacles", false], ["the-hermit", true], ["six-of-swords", true]];
    const by = (intent: "clarify" | "decide" | "companion") => buildLocalReading(req("career", intent, cards));
    for (const intent of ["clarify", "decide", "companion"] as const) expect(selectLocalFocus(req("career", intent, cards)), intent).toBeNull();
    expect(by("clarify").overall).toContain("值得先核对的是：如果最近常一个人想事情，是在整理，还是在回避");
    expect(by("clarify").overall).toContain("核对之后可以试的一步：如果有问题反复出现，先把它看清。");
    expect(by("decide").overall).toContain("做决定之前可以先试的一步：如果有问题反复出现，先把它看清。");
    expect(by("companion").overall).toContain("只试这一小步：如果有问题反复出现，先把它看清。");
    // 三张牌的要点之间用分号隔开（句内有逗号时分得清哪里换牌）
    expect(by("clarify").overall.split("；").length).toBe(3);
    // 行动与追问落在这一步上，而且都是条件口径
    expect(by("clarify").action).toMatch(/^如果.+反复出现/);
    expect(by("clarify").question).toMatch(/^如果.+反复出现/);
  });

  it("主题变体也能改写首牌的说明：关系主题里星币三不讲分工（评分表样本 10）", () => {
    const r = buildLocalReading(req("relationship", "clarify", [["three-of-pentacles", false], ["the-tower", true], ["queen-of-wands", false]]));
    expect(r.cards[0].text).toContain("期待");
    expect([r.overall, ...r.cards.map((c) => c.text), ...r.interpretations, r.action, r.question].join("")).not.toMatch(/分工|做成一个最粗糙的版本|拿给谁看/);
    expect(r.action).not.toMatch(/联系|发消息|一起|对方回复/);
  });

  it("合作牌族的末牌：自我主题讲自己的完成标准，去留主题讲选项依赖的条件，都不写多人分工（评分表样本 13、22）", () => {
    // 自我：星币二 / 宝剑六（逆位）/ 星币三——没有锚牌，仍走按位置路径
    expect(selectLocalFocus(req("self", "clarify", [["two-of-pentacles", false], ["six-of-swords", true], ["three-of-pentacles", false]]))).toBeNull();
    const self = buildLocalReading(req("self", "clarify", [["two-of-pentacles", false], ["six-of-swords", true], ["three-of-pentacles", false]]));
    expect([self.overall, self.cards[2].text, self.interpretations[1], self.action, self.question].join("")).not.toMatch(/分工|各自负责|共同的小任务/);
    expect(self.action).toContain("完成");
    const crossroads = buildLocalReading(req("crossroads", "clarify", [["page-of-pentacles", false], ["the-hermit", true], ["three-of-pentacles", false]]));
    expect([crossroads.overall, crossroads.cards[2].text, crossroads.interpretations[1], crossroads.action, crossroads.question].join("")).not.toMatch(/分工|各自负责|共同的小任务/);
    expect(crossroads.action).toContain("条件");
    // 学习牌族：去留主题的首牌不讲“学一件新事”
    expect(crossroads.cards[0].text).not.toMatch(/学/);
  });

  it("离开牌族不预设要走：自我主题的陪伴里，宝剑六（逆位）的行动和追问不推进“离开”、不冒认“最近三次”（评分表样本 21）", () => {
    const r = buildLocalReading(req("self", "companion", [["two-of-pentacles", false], ["three-of-pentacles", false], ["six-of-swords", true]]));
    const all = [r.overall, ...r.cards.map((c) => c.text), ...r.interpretations, r.action, r.question].join("");
    expect(all).not.toMatch(/离开|换环境|想走|三次|分工/);
    expect(r.question).toMatch(/^如果/);
    // 关系主题里死神讲相处方式的收尾，不读成结束关系
    const death = buildLocalReading(req("relationship", "clarify", [["the-hermit", false], ["eight-of-wands", false], ["death", false]]));
    expect(death.cards[2].text).toContain("相处方式");
  });

  it("负担类主张不把“读者超载”当成前提：自我主题下行动与追问都是条件口径，结果里没有内部说法“末牌”", () => {
    const r = buildLocalReading(req("self", "clarify", [["two-of-pentacles", true], ["page-of-pentacles", false], ["death", true]]));
    expect(selectLocalFocus(req("self", "clarify", [["two-of-pentacles", true], ["page-of-pentacles", false], ["death", true]]))).toBe("load-transition");
    expect(r.action).toContain("如果偏多");
    expect(r.question).toMatch(/^如果/);
    expect(r.overall).not.toMatch(/过渡|再决定要放下哪一项/);
    expect(allStrings.map(([, t]) => t).join("\n")).not.toContain("末牌");
  });

  it("命中主张时，没有贡献的牌按主题变体取说明，并且陪伴读法不要求分两栏分析（评分表样本 6）", () => {
    const r = buildLocalReading(req("crossroads", "companion", [["the-tower", true], ["four-of-swords", false], ["queen-of-wands", false]]));
    expect(selectLocalFocus(req("crossroads", "companion", [["the-tower", true], ["four-of-swords", false], ["queen-of-wands", false]]))).toBe("settle-feelings");
    expect(r.overall).toContain("权杖王后可能在提示热度可以先用来照顾自己");
    expect(r.cards[2].text).not.toContain("被别人看见");
    expect(r.interpretations.join("")).not.toMatch(/两栏|写下/);
  });
});

describe("v2.10：3 个后备共同解释（先听自己 / 收尾与重建 / 势头与确认）", () => {
  type Focus = (typeof LOCAL_V2.focuses)[number];
  const FRESH = ["inner-first", "rebuild", "momentum-check"];
  const ids = Object.keys(LOCAL_V2.cards);
  const tagsOf = (cardId: string, reversed: boolean) => (LOCAL_V2.cards as Record<string, { upright: { tags: string[] }; reversed: { tags: string[] } }>)[cardId][reversed ? "reversed" : "upright"].tags;
  /** 选择规则的参照实现（只用来和引擎对账）：每张牌取权重最大的标记，至少两张贡献且总分 ≥ need */
  const scoreOf = (focus: Focus, tags: string[][], intent: string) => {
    if (focus.excludeIntents?.includes(intent)) return null;
    if (focus.requireAny && !tags.some((t) => t.some((x) => focus.requireAny!.includes(x)))) return null;
    const tops = tags.map((t) => t.reduce<string | null>((top, x) => (focus.weights[x] && (top === null || focus.weights[x] > focus.weights[top]) ? x : top), null));
    const score = tops.reduce((n, x) => n + (x ? focus.weights[x] : 0), 0);
    return tops.filter(Boolean).length >= 2 && score >= focus.need ? score : null;
  };
  const bestOf = (pool: Focus[], tags: string[][], intent: string) => pool.reduce<{ id: string; score: number } | null>((b, f) => { const s = scoreOf(f, tags, intent); return s !== null && (!b || s > b.score) ? { id: f.id, score: s } : b; }, null);
  const req = (topic: ReadingRequest["topic"], intent: NonNullable<ReadingRequest["intent"]>, cards: [string, boolean][]) =>
    make({ topic, intent, cards: cards.map(([cardId, reversed], position) => ({ cardId, position, reversed })) as ReadingRequest["cards"] });
  const all = (r: ReturnType<typeof buildLocalReading>) => [r.overall, ...r.cards.map((c) => c.text), ...r.interpretations, r.action, r.question].join("\n");

  it("新主张都是后备层，并且都指定了锚牌；原有 5 个主张的权重和范围没有变", () => {
    for (const f of LOCAL_V2.focuses.filter((x) => FRESH.includes(x.id))) {
      expect(f.fallback, f.id).toBe(true);
      expect(f.requireAny?.length, f.id).toBeGreaterThan(0);
      for (const tag of f.requireAny!) expect(f.weights[tag], `${f.id}/${tag} 锚牌标记要有最高权重`).toBe(2);
    }
    expect(LOCAL_V2.focuses.filter((x) => !x.fallback).map((x) => x.id)).toEqual(["small-trial", "warm-juggle", "load-transition", "settle-feelings", "invest-cooperate"]);
  });

  it("全量枚举（12 张牌 × 正逆位 × 顺序 × 三种意图）：原来命中的组合一例不变；后备主张只接原来不命中的组合，而且锚牌在场", () => {
    const originals = LOCAL_V2.focuses.filter((f) => !f.fallback);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const a of ids) for (const b of ids) for (const c of ids) {
      if (a === b || a === c || b === c) continue;
      for (let mask = 0; mask < 8; mask++) {
        const cards: [string, boolean][] = [[a, !!(mask & 1)], [b, !!(mask & 2)], [c, !!(mask & 4)]];
        const tags = cards.map(([id, rev]) => tagsOf(id, rev));
        for (const intent of ["clarify", "decide", "companion"] as const) {
          const before = bestOf(originals, tags, intent)?.id ?? null;
          const now = selectLocalFocus(req("career", intent, cards));
          if (before) expect(now, `${cards.join("/")} ${intent}`).toBe(before);
          else if (now) {
            const focus = LOCAL_V2.focuses.find((f) => f.id === now)!;
            expect(focus.fallback, `${cards.join("/")} ${intent}`).toBe(true);
            expect(tags.some((t) => t.some((x) => focus.requireAny!.includes(x))), `${cards.join("/")} 没有锚牌却命中 ${now}`).toBe(true);
          }
          if (intent === "clarify") { counts[now ?? "(未命中)"] = (counts[now ?? "(未命中)"] ?? 0) + 1; total++; }
        }
      }
    }
    const share = (id: string) => (counts[id] ?? 0) / total;
    // 设计时的预期：未命中 56.9% → 约 17%；三个新主张各占一成多，没有哪个一家独大
    expect(total).toBe(10560);
    expect(share("(未命中)")).toBeLessThan(0.2);
    for (const id of FRESH) {
      expect(share(id), id).toBeGreaterThan(0.08);
      expect(share(id), id).toBeLessThan(0.2);
    }
  });

  it("命中后备主张时：整体先给主张，三张牌都出现；没有专门角色句的搭档牌用它自己按主题取值的要点（关系主题里星币三不讲分工）", () => {
    // 评分表样本 1：隐士（逆位）/ 死神 / 高塔，事业 · 理清——原来走按位置路径
    const r = buildLocalReading(req("career", "clarify", [["the-hermit", true], ["death", false], ["the-tower", false]]));
    expect(selectLocalFocus(req("career", "clarify", [["the-hermit", true], ["death", false], ["the-tower", false]]))).toBe("rebuild");
    expect(r.overall).toContain("这组牌的重点是先看清什么还在、什么已经告一段落，再从一小块重新开始。");
    for (const name of ["隐士（逆位）", "死神", "高塔"]) expect(r.overall).toContain(name);
    expect(r.overall).not.toContain("值得先核对的是");
    // 预留组合 r9 的牌换到关系主题：星币三只有权重、没有角色句 → 用它在关系主题下的一句话要点与说明
    const rel = buildLocalReading(req("relationship", "clarify", [["three-of-pentacles", false], ["the-hermit", false], ["two-of-pentacles", false]]));
    expect(selectLocalFocus(req("relationship", "clarify", [["three-of-pentacles", false], ["the-hermit", false], ["two-of-pentacles", false]]))).toBe("inner-first");
    expect(rel.overall).toContain("星币三可能在提示期待有没有说清");
    expect(all(rel)).not.toMatch(/分工|各自负责/);
  });

  it("关系主题：三个新主张的行动都只涉及自己，不预设联系对方或“一起”", () => {
    const combos: [string, [string, boolean][]][] = [
      ["inner-first", [["page-of-cups", false], ["queen-of-wands", true], ["the-hermit", true]]],
      ["rebuild", [["the-tower", false], ["three-of-pentacles", true], ["page-of-pentacles", true]]],
      ["momentum-check", [["eight-of-wands", false], ["knight-of-swords", true], ["six-of-swords", true]]],
    ];
    for (const [id, cards] of combos) {
      for (const intent of ["clarify", "decide", "companion"] as const) {
        const request = req("relationship", intent, cards);
        expect(selectLocalFocus(request), `${id}/${intent}`).toBe(id);
        const r = buildLocalReading(request);
        expect(r.action, `${id}/${intent}`).not.toMatch(/联系|发消息|一起|对方回复|告诉对方|约对方/);
        if (intent !== "companion") expect(r.overall + r.action, `${id}/${intent}`).toMatch(/这段关系|自己/);
      }
    }
  });

  it("行动跟着末牌变：同一主张下，末牌换成不同类型的牌，行动与追问不同（缓解“同一主张千篇一律”）", () => {
    const withLast = (last: [string, boolean]) => buildLocalReading(req("career", "clarify", [["two-of-pentacles", false], ["the-hermit", false], last]));
    const [push, study, plain] = [withLast(["knight-of-swords", false]), withLast(["page-of-pentacles", false]), withLast(["queen-of-wands", true])];
    for (const last of [["knight-of-swords", false], ["page-of-pentacles", false], ["queen-of-wands", true]] as [string, boolean][]) expect(selectLocalFocus(req("career", "clarify", [["two-of-pentacles", false], ["the-hermit", false], last]))).toBe("inner-first");
    expect(new Set([push.action, study.action, plain.action]).size).toBe(3);
    expect(new Set([push.question, study.question, plain.question]).size).toBe(3);
    expect(push.action).toContain("最直接的一步");
    expect(study.action).toContain("小功课");
  });

  it("自我主题下，末牌是星币三时行动落在“完成”的标准上，不写多人分工（评分表样本 13，现在命中“收尾与重建”）", () => {
    const request = req("self", "clarify", [["four-of-swords", true], ["death", false], ["three-of-pentacles", false]]);
    expect(selectLocalFocus(request)).toBe("rebuild");
    const r = buildLocalReading(request);
    expect(all(r)).not.toMatch(/分工|各自负责|共同的小任务|需要谁/);
    expect(r.action).toContain("完成");
    expect(r.cards[2].text).toContain("完成标准");
  });
});
