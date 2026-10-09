import { describe, expect, it } from "vitest";
import { BANNED_PHRASES, TOPICS } from "@/features/cards/schema";
import { QUESTION_BANK } from "./questions";

describe("question bank", () => {
  it("covers every topic", () => {
    expect(Object.keys(QUESTION_BANK.topics).sort()).toEqual([...TOPICS].sort());
  });

  it("asks open questions, not yes/no predictions", () => {
    const all = [
      ...Object.values(QUESTION_BANK.topics).flatMap((t) => t.examples),
      ...QUESTION_BANK.unsure.prompts,
    ];
    for (const q of all) {
      expect(/会不会|能不能成|是否会/.test(q), q).toBe(false);
      for (const phrase of BANNED_PHRASES) expect(q.includes(phrase), q).toBe(false);
    }
  });
});
