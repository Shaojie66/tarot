import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { CONTENT_VERSION, RECORD_SCHEMA_VERSION, type ReadingRecord } from "./contract";
import { buildLocalReading } from "./local";
import { countRecords, getRecord, saveRecord } from "./storage";

const request = {
  spreadId: "three-card" as const,
  topic: "crossroads" as const,
  originalQuestion: "走还是留",
  question: "走还是留",
  selfReading: "",
  cards: [
    { cardId: "the-hermit" as const, position: 0, reversed: false },
    { cardId: "six-of-swords" as const, position: 1, reversed: false },
    { cardId: "ace-of-pentacles" as const, position: 2, reversed: true },
  ],
};
const result = buildLocalReading(request);

const record: ReadingRecord = {
  id: "abcdef0123456789",
  schemaVersion: RECORD_SCHEMA_VERSION,
  deckId: "rws-1909",
  settings: { allowReversed: true },
  createdAt: new Date().toISOString(),
  request,
  result,
  choice: { interpretation: null, rejected: [], action: { status: "accepted", text: result.action } },
  versions: { content: CONTENT_VERSION, prompt: null, model: null },
};

describe("record storage", () => {
  it("saves once per id and keeps the latest choice", async () => {
    await saveRecord(record);
    await saveRecord({ ...record, choice: { ...record.choice, interpretation: 1 } });
    expect(await countRecords()).toBe(1);
    expect((await getRecord(record.id))?.choice.interpretation).toBe(1);
  });

  it("refuses invalid records", async () => {
    await expect(saveRecord({ ...record, id: "x" })).rejects.toThrow();
  });
});
