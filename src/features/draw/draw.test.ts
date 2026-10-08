import { describe, expect, it } from "vitest";
import { ALL_CARD_IDS } from "@/features/cards/ids";
import { drawCards, isValidDraw } from "./draw";
import { cryptoRandomInt, shuffle } from "./random";

describe("card ids", () => {
  it("has 78 unique cards", () => {
    expect(ALL_CARD_IDS).toHaveLength(78);
    expect(new Set(ALL_CARD_IDS).size).toBe(78);
  });
});

describe("cryptoRandomInt", () => {
  it("stays in range", () => {
    for (let i = 0; i < 1000; i++) {
      const n = cryptoRandomInt(78);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(78);
    }
  });

  it("rejects invalid bounds", () => {
    expect(() => cryptoRandomInt(0)).toThrow(RangeError);
    expect(() => cryptoRandomInt(1.5)).toThrow(RangeError);
  });
});

describe("shuffle", () => {
  it("is a permutation and does not mutate input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual(input);
  });

  it("is roughly uniform for the first slot", () => {
    const counts = new Map<number, number>();
    const trials = 30_000;
    for (let i = 0; i < trials; i++) {
      const first = shuffle([0, 1, 2])[0];
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    for (const v of [0, 1, 2]) {
      expect((counts.get(v) ?? 0) / trials).toBeGreaterThan(0.3);
      expect((counts.get(v) ?? 0) / trials).toBeLessThan(0.37);
    }
  });
});

describe("drawCards", () => {
  it("draws unique cards with sequential positions", () => {
    const cards = drawCards({ count: 3, allowReversed: true });
    expect(cards.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(new Set(cards.map((c) => c.cardId)).size).toBe(3);
    expect(isValidDraw(cards, 3)).toBe(true);
  });

  it("never reverses when disabled", () => {
    for (let i = 0; i < 50; i++) {
      expect(drawCards({ count: 3, allowReversed: false }).every((c) => !c.reversed)).toBe(true);
    }
  });
});

describe("isValidDraw", () => {
  const ok = [
    { cardId: "the-fool", position: 0, reversed: false },
    { cardId: "ace-of-cups", position: 1, reversed: true },
  ];

  it("accepts a valid draw", () => expect(isValidDraw(ok, 2)).toBe(true));
  it("rejects wrong count", () => expect(isValidDraw(ok, 3)).toBe(false));
  it("rejects unknown card", () =>
    expect(isValidDraw([{ ...ok[0], cardId: "the-joker" }, ok[1]], 2)).toBe(false));
  it("rejects duplicates", () => expect(isValidDraw([ok[0], { ...ok[0], position: 1 }], 2)).toBe(false));
  it("rejects bad positions", () => expect(isValidDraw([ok[1], ok[0]], 2)).toBe(false));
});
