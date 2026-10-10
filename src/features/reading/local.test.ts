import { describe, expect, it } from "vitest";
import { findForbiddenPhrase } from "./guard";
import { buildLocalReading, LOCAL_TEMPLATE } from "./local";
import { INTENTS } from "@/features/profile/intent";
import { readingRequestSchema, readingResultSchema, resultMatchesDraw } from "./contract";
import { TOPICS } from "@/features/cards/schema";

describe("本地模板的关系类行动", () => {
  // 断联、冲突、需要边界的情境下，默认行动不能是联系、感谢、邀约或共同活动：用户可以单独完成，不涉及对方。
  const CONTACT = /联系|发起|邀约|(?<!不用)(?<!不必)告诉对方|对.{0,4}说一句|感谢|一起|分担|找一个合适的时刻/;

  it.each(Object.entries(LOCAL_TEMPLATE.actions))("%s 的关系行动不预设与对方接触", (_suit, byTopic) => {
    expect(byTopic.relationship).not.toMatch(CONTACT);
  });

});

describe("按“这次想要的帮助”换语气（本地解读）", () => {
  const request = (topic: (typeof TOPICS)[number], intent?: (typeof INTENTS)[number]) =>
    readingRequestSchema.parse({
      spreadId: "three-card",
      topic,
      originalQuestion: "q",
      question: "我在这件事里想要什么？",
      selfReading: "",
      ...(intent ? { intent } : {}),
      cards: [
        { cardId: "the-hermit", position: 0, reversed: false },
        { cardId: "six-of-swords", position: 1, reversed: true },
        { cardId: "ace-of-pentacles", position: 2, reversed: false },
      ],
    });

  it("不同意图给出不同的开场、读法引导、小行动和反问；默认与 clarify 一致", () => {
    const base = buildLocalReading(request("career"));
    const clarify = buildLocalReading(request("career", "clarify"));
    expect(clarify).toEqual(base);
    for (const intent of ["decide", "companion"] as const) {
      const r = buildLocalReading(request("career", intent));
      expect(r.overall).not.toBe(base.overall);
      expect(r.interpretations[0]).not.toBe(base.interpretations[0]);
      expect(r.action).not.toBe(base.action);
      expect(r.question).not.toBe(base.question);
      // 牌与牌面解读不变：意图只改语气，不改牌
      expect(r.cards).toEqual(base.cards);
    }
  });

  it.each(INTENTS.flatMap((i) => TOPICS.map((t) => [i, t] as const)))("%s × %s：通过全部硬检查", (intent, topic) => {
    const req = request(topic, intent);
    const result = readingResultSchema.parse(buildLocalReading(req));
    expect(resultMatchesDraw(result, req)).toBe(true);
    expect(findForbiddenPhrase([result.overall, ...result.cards.map((c) => c.text), ...result.interpretations, result.action, result.question])).toBeNull();
    expect(result.interpretations[0]).not.toBe(result.interpretations[1]);
    expect(result.question).toMatch(/？$/);
  });

  it("决定 / 陪伴的小行动不预设联系对方，且都可以只留给自己", () => {
    const CONTACT = /联系|发起|邀约|(?<!不用)(?<!不必)告诉对方|感谢|一起|分担|找一个合适的时刻/;
    for (const intent of ["decide", "companion"] as const) {
      for (const topic of TOPICS) {
        const text = LOCAL_TEMPLATE.intents[intent].actions[topic];
        expect(text, `${intent}/${topic}`).not.toMatch(CONTACT);
        expect(text.length).toBeGreaterThan(8);
        expect(findForbiddenPhrase([text])).toBeNull();
      }
    }
  });

  it("决定类语气里没有“你应该选 / 该选”这类替用户做决定的说法", () => {
    for (const topic of TOPICS) {
      const r = buildLocalReading(request(topic, "decide"));
      expect([r.overall, ...r.interpretations, r.action, r.question].join("")).not.toMatch(/你应该选|你该选|最好选|建议你选/);
    }
  });
});
