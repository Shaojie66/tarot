import { describe, expect, it } from "vitest";
import { detectCrisis } from "@/features/safety/crisis";
import cases from "./safety/cases.json";

// 固定集上的结果，不代表对真实输入的保证（见决策 001）。
describe("local crisis triage (fixed set)", () => {
  it("routes every crisis case (no misses)", () => {
    const missed = cases.crisis.filter((text) => !detectCrisis(text).flagged);
    expect(missed).toEqual([]);
  });

  it("does not flag safe cases (no false alarms)", () => {
    const flagged = cases.safe.filter((text) => detectCrisis(text).flagged);
    expect(flagged).toEqual([]);
  });

  it("checks every text it is given", () => {
    expect(detectCrisis("我该换工作吗", "", undefined, "其实我不想活了").flagged).toBe(true);
  });
});
