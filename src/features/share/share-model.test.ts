import { describe, expect, it } from "vitest";
import { CONTENT_VERSION, RECORD_SCHEMA_VERSION, type ReadingRecord } from "@/features/reading/contract";
import { buildLocalReading } from "@/features/reading/local";
import { SHARE_DISCLAIMER, SHARE_TITLE, buildShareModel, describeShare, shareableAction } from "./share-model";

// 合成的个人信息：每一处都放一个独特的标记，断言它们默认不出现在分享模型里。
const SECRET = {
  name: "合成姓名张三丰",
  event: "合成事件离职面谈",
  question: "合成问题我该不该离开星河公司",
  original: "合成原话星河公司好烦",
  self: "合成自解想起了外婆",
  edited: "合成编辑行动给李四发一封信",
  note: "合成笔记那天下雨",
  followUp: "合成复盘写到一半就哭了",
  id: "secretid0123456789abcdef",
  perspective: "合成换视角内容",
};

function record(over: Partial<ReadingRecord> = {}): ReadingRecord {
  const request = {
    spreadId: "three-card" as const,
    topic: "relationship" as const,
    originalQuestion: SECRET.original,
    question: `${SECRET.question}${SECRET.name}`,
    selfReading: `${SECRET.self}${SECRET.event}`,
    cards: [
      { cardId: "the-hermit" as const, position: 0, reversed: false },
      { cardId: "six-of-swords" as const, position: 1, reversed: true },
      { cardId: "ace-of-pentacles" as const, position: 2, reversed: false },
    ],
  };
  const result = buildLocalReading(request);
  // 模拟 overall / 逐牌文本复述用户原话（本地模板会把自解放进 overall）
  result.cards[0].text = `${result.cards[0].text}${SECRET.name}`;
  return {
    id: SECRET.id,
    schemaVersion: RECORD_SCHEMA_VERSION,
    deckId: "rws-1909",
    settings: { allowReversed: true },
    createdAt: new Date(Date.UTC(2026, 9, 9, 8, 15, 42)).toISOString(),
    request,
    result,
    choice: { interpretation: 0, rejected: [], action: { status: "edited", text: SECRET.edited } },
    versions: { content: CONTENT_VERSION, prompt: "v2", model: "secret-model-name" },
    perspectives: [
      {
        id: "persp-secret-0001",
        tone: "support",
        createdAt: new Date(Date.UTC(2026, 9, 12)).toISOString(),
        source: "ai",
        versions: { content: CONTENT_VERSION, prompt: "v3", model: "secret-model-name" },
        body: { overall: `${SECRET.perspective}整体`, interpretations: [`${SECRET.perspective}甲`, `${SECRET.perspective}乙`], question: `${SECRET.perspective}你想先弄清楚什么？` },
      },
    ],
    review: {
      moods: ["迷茫"],
      note: SECRET.note,
      followUp: { status: "done", note: SECRET.followUp, at: new Date(Date.UTC(2026, 9, 11)).toISOString() },
      updatedAt: new Date(Date.UTC(2026, 9, 11)).toISOString(),
    },
    ...over,
  } as ReadingRecord;
}

describe("分享白名单：默认只有安全字段", () => {
  const model = buildShareModel(record());
  const dump = JSON.stringify(model) + describeShare(model);

  it("模型的键与卡片的键恰好是白名单", () => {
    expect(Object.keys(model).sort()).toEqual(["attribution", "cards", "deckId", "disclaimer", "title"]);
    for (const card of model.cards) expect(Object.keys(card).sort()).toEqual(["imageSrc", "keywords", "nameZh", "positionLabel", "reversed"]);
  });

  it("任何个人内容都不出现：问题、原话、自解、解读正文、编辑行动、笔记、复盘、id、时间、主题、模型版本", () => {
    for (const [key, secret] of Object.entries(SECRET)) expect(dump, key).not.toContain(secret);
    // 日期 / 时间 / 主题标签 / 站点地址 / 版本信息
    expect(dump).not.toMatch(/2026|T08:15|关系|relationship|https?:\/\/|localhost|secret-model|cards-2026|v2/);
    // 解读正文：本地模板写在 overall / 读法里的句子
    const { result } = record();
    for (const text of [result.overall, ...result.interpretations, result.action, result.question]) expect(dump).not.toContain(text);
  });

  it("包含：牌名、正逆位、位置标签、关键词、牌组署名、固定标题与免责声明", () => {
    expect(model.title).toBe(SHARE_TITLE);
    expect(model.disclaimer).toBe(SHARE_DISCLAIMER);
    expect(model.attribution).toBe("莱德-韦特 1909 原版");
    expect(model.cards.map((c) => [c.nameZh, c.reversed])).toEqual([
      ["隐士", false],
      ["宝剑六", true],
      ["星币王牌", false],
    ]);
    expect(model.cards[0].positionLabel).toBe("此刻的处境");
    expect(model.cards[0].keywords).toHaveLength(3);
    expect(model.cards[1].imageSrc).toBe("/decks/rws-1909/six-of-swords.webp");
  });

  it("免责声明不含网址", () => {
    expect(SHARE_DISCLAIMER).not.toMatch(/https?:|www\.|\.com|localhost/);
  });
});

describe("个性化内容：只有勾选才出现，且只出现勾选的那一项", () => {
  it("勾选问题：只多出确认后的问题", () => {
    const m = buildShareModel(record(), { includeQuestion: true, includeAction: false });
    expect(m.question).toContain(SECRET.question);
    expect(m.action).toBeUndefined();
    const dump = JSON.stringify(m);
    for (const secret of [SECRET.original, SECRET.self, SECRET.event, SECRET.edited, SECRET.note, SECRET.followUp]) expect(dump).not.toContain(secret);
  });

  it("勾选行动：用户编辑过就用用户的版本；接受就用建议原文", () => {
    const edited = buildShareModel(record(), { includeQuestion: false, includeAction: true });
    expect(edited.action).toBe(SECRET.edited);
    expect(edited.question).toBeUndefined();

    const base = record();
    const accepted = { ...base, choice: { ...base.choice, action: { status: "accepted", text: base.result.action } } } as ReadingRecord;
    expect(buildShareModel(accepted, { includeQuestion: false, includeAction: true }).action).toBe(base.result.action);
  });

  it("未决定 / 跳过的行动没有可分享的内容，即使勾选也不会出现", () => {
    const base = record();
    for (const status of ["undecided", "skipped"] as const) {
      const r = { ...base, choice: { ...base.choice, action: { status, text: "" } } } as ReadingRecord;
      expect(shareableAction(r)).toBeNull();
      expect(buildShareModel(r, { includeQuestion: false, includeAction: true }).action).toBeUndefined();
    }
  });

  it("v1 旧记录（无牌组字段）按默认牌组出图，不抛异常", () => {
    const v1 = { ...record(), schemaVersion: 1 } as Record<string, unknown>;
    delete v1.deckId;
    delete v1.settings;
    const m = buildShareModel(v1 as unknown as ReadingRecord);
    expect(m.deckId).toBe("rws-1909");
  });
});
