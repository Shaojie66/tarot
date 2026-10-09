import { describe, expect, it } from "vitest";
import { normalizeCards, normalizeInterpretations, normalizePerspectiveBody, normalizeReadingBody, parseModelJson, repairNote } from "./model-output";

describe("parseModelJson：从各种模型的文本里取出 JSON", () => {
  const obj = { crisis: false, a: "含 } 花括号 \" 引号的文字" };
  const text = JSON.stringify(obj);
  it.each([
    ["纯 JSON", text],
    ["带 ```json 围栏", "```json\n" + text + "\n```"],
    ["带无语言围栏", "```\n" + text + "\n```"],
    ["前后有解释文字", "好的，这是结果：\n" + text + "\n希望有帮助"],
    ["围栏 + 前缀文字", "结果如下\n```json\n" + text + "\n```"],
  ])("%s", (_name, raw) => {
    expect(parseModelJson(raw)).toEqual(obj);
  });

  it("取不出对象 / 截断 / 空 → undefined", () => {
    for (const raw of ["", "没有 JSON", '{"a": ', "[1,2"]) expect(parseModelJson(raw)).toBeUndefined();
  });
});

describe("无损整理", () => {
  it("cards：丢弃多余键，只保留四个；字符串数字 / 布尔拉回类型", () => {
    expect(normalizeCards([{ cardId: "death", position: "1", reversed: "true", text: "文", name: "死神", keywords: ["x"] }])).toEqual([
      { cardId: "death", position: 1, reversed: true, text: "文" },
    ]);
  });

  it("cards：不补缺失的键、不改文字、不改 cardId", () => {
    expect(normalizeCards([{ cardId: "death", text: "文" }])).toEqual([{ cardId: "death", text: "文" }]);
    expect(normalizeCards("not-an-array")).toBe("not-an-array");
  });

  it("interpretations：套了一层的字符串数组拼成字符串；{text} 取 text；个数不改", () => {
    expect(normalizeInterpretations([["读法甲，", "第二句"], { text: "读法乙" }])).toEqual(["读法甲，第二句", "读法乙"]);
    expect(normalizeInterpretations(["a", "b", "c"])).toEqual(["a", "b", "c"]); // 3 个：交给校验拒绝，不替模型挑
  });

  it("顶层：只保留规定的键（丢掉 reasoning / action 之外的杂项）；perspective 不含 action", () => {
    const raw = { crisis: false, overall: "o", cards: [], interpretations: ["a", "b"], action: "x", question: "q？", reasoning: "我先想想……", extra: 1 };
    expect(Object.keys(normalizeReadingBody(raw) as object).sort()).toEqual(["action", "cards", "interpretations", "overall", "question"]);
    expect(Object.keys(normalizePerspectiveBody(raw) as object).sort()).toEqual(["interpretations", "overall", "question"]);
  });

  it("repairNote 只含字段位置与问题类型", () => {
    const note = repairNote(["cards.N: unrecognized_keys", "interpretations: too_big"]);
    expect(note).toContain("cards.N: unrecognized_keys");
    expect(note).toContain("不要多余的字段");
  });
});
