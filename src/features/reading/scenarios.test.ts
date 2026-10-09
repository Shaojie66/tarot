import { describe, expect, it } from "vitest";
import { SCENARIOS, orderScenarios } from "./scenarios";

describe("orderScenarios", () => {
  const ids = (xs: { id: string }[]) => xs.map((s) => s.id);
  it("没有偏好：默认顺序", () => {
    expect(ids(orderScenarios([]))).toEqual(ids(SCENARIOS));
  });
  it("偏好的主题排前面，保持各自原有顺序；“此刻”永远最后；一张不少", () => {
    expect(ids(orderScenarios(["crossroads", "relationship"]))).toEqual(["relationship", "crossroads", "career", "self", "topicless"]);
    expect(ids(orderScenarios(["self"]))).toEqual(["self", "relationship", "career", "crossroads", "topicless"]);
    expect(orderScenarios(["career"])).toHaveLength(SCENARIOS.length);
  });
});
