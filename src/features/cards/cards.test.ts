import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getAllCards } from "./cards";
import { DECKS, cardImageSrc, type DeckId } from "./deck";
import { BANNED_PHRASES } from "./schema";

const cards = getAllCards();
const publicDir = fileURLToPath(new URL("../../../public", import.meta.url));

describe("card content", () => {
  it("loads all 78 cards in canonical order", () => {
    expect(cards).toHaveLength(78);
    expect(cards.filter((c) => c.arcana === "major")).toHaveLength(22);
    expect(cards[0].id).toBe("the-fool");
    expect(cards[77].id).toBe("king-of-pentacles");
  });

  it("numbers majors 0–21 and minors 1–14 per suit", () => {
    cards
      .filter((c) => c.arcana === "major")
      .forEach((c, i) => expect(c.number, c.id).toBe(i));
    for (const suit of ["wands", "cups", "swords", "pentacles"] as const) {
      expect(cards.filter((c) => c.suit === suit).map((c) => c.number)).toEqual(
        Array.from({ length: 14 }, (_, i) => i + 1),
      );
    }
  });

  it("never uses fatalistic phrasing", () => {
    for (const card of cards) {
      const all = JSON.stringify([card.upright, card.reversed]);
      for (const phrase of BANNED_PHRASES) {
        expect(all.includes(phrase), `${card.id} contains “${phrase}”`).toBe(false);
      }
    }
  });

  it("has unique Chinese names", () => {
    expect(new Set(cards.map((c) => c.nameZh)).size).toBe(78);
  });
});

describe("decks", () => {
  it.each(Object.keys(DECKS) as DeckId[])("%s has an image for every card", (deck) => {
    const missing = cards.filter((c) => !existsSync(publicDir + cardImageSrc(c.id, deck)));
    expect(missing.map((c) => c.id)).toEqual([]);
  });
});
