import { describe, expect, it } from "vitest";
import { TopLevelSections } from "./json-sections";

function feed(json: string, size: number) {
  const parser = new TopLevelSections();
  const out = [];
  for (let i = 0; i < json.length; i += size) out.push(...parser.push(json.slice(i, i + size)));
  return out;
}

describe("TopLevelSections", () => {
  const value = { crisis: false, overall: 'a "quoted", {brace} [x]', cards: [{ id: 1, t: "}," }], action: "做", n: 3 };
  const json = JSON.stringify(value, null, 2);

  it.each([1, 3, 7, 1000])("emits each complete top-level field (chunk %i)", (size) => {
    const sections = feed(json, size);
    expect(sections.map((s) => s.key)).toEqual(Object.keys(value));
    for (const s of sections) expect(JSON.parse(s.raw)).toEqual(value[s.key as keyof typeof value]);
  });

  it("never emits an incomplete field", () => {
    const cut = json.slice(0, json.indexOf('"action"') + 12);
    expect(feed(cut, 5).map((s) => s.key)).toEqual(["crisis", "overall", "cards"]);
  });
});
