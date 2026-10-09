import { describe, expect, it } from "vitest";
import { LOCAL_TEMPLATE } from "./local";

describe("本地模板的关系类行动", () => {
  // 断联、冲突、需要边界的情境下，默认行动不能是联系、感谢、邀约或共同活动：用户可以单独完成，不涉及对方。
  const CONTACT = /联系|发起|邀约|(?<!不用)(?<!不必)告诉对方|对.{0,4}说一句|感谢|一起|分担|找一个合适的时刻/;

  it.each(Object.entries(LOCAL_TEMPLATE.actions))("%s 的关系行动不预设与对方接触", (_suit, byTopic) => {
    expect(byTopic.relationship).not.toMatch(CONTACT);
  });

  it("每条关系行动都明确可以只留给自己", () => {
    for (const byTopic of Object.values(LOCAL_TEMPLATE.actions)) {
      expect(byTopic.relationship).toMatch(/自己|不用告诉对方|不说也可以|不必发给任何人|不用马上处理/);
    }
  });
});
