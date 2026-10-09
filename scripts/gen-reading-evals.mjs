// 生成固定解读评测用例 evals/reading/cases.json（可重复运行，种子固定，结果稳定）。
// 用法：node scripts/gen-reading-evals.mjs
// 评测用例的抽牌是固定的测试数据，不是产品抽牌；产品抽牌只用 crypto.getRandomValues。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ids = ["major", "wands", "cups", "swords", "pentacles"].flatMap((f) =>
  JSON.parse(readFileSync(`${root}content/cards/${f}.json`, "utf8")).map((c) => c.id),
);

// mulberry32：仅用于生成可复现的测试数据
let seed = 20261009;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const QUESTIONS = {
  career: ["我在这份工作里到底想要什么？", "怎么面对一直升不上去的处境？", "我该把精力放在哪个方向？", "工作好累", "老板总挑刺我该怎么办", "我适合做什么？", "转行这件事我在怕什么？", "不知道", "考研还是工作，我在纠结什么？", "怎样让每天上班不那么难熬？"],
  relationship: ["我在这段关系里真正需要的是什么？", "怎么和父母谈我的选择？", "他到底怎么想的", "我为什么总是在关系里讨好别人？", "怎样和好朋友修复关系？", "分手后我该怎么走出来？", "暗恋一个人好久了", "我们之间的距离是怎么来的？", "烦", "我怎样更好地表达自己的需要？"],
  self: ["我最近为什么总是提不起劲？", "我是谁", "怎样和焦虑相处？", "什么在消耗我的能量？", "我在回避什么？", "怎样对自己好一点？", "最近很迷茫", "我真正在意的是什么？", "怎么停止和别人比较？", "随便问问"],
  crossroads: ["留在大城市还是回老家，我在纠结什么？", "离开这份工作我在怕什么？", "我该不该出国", "两个offer怎么选？", "要不要搬出去住？", "继续读书对我意味着什么？", "这段关系还要不要继续", "什么能帮我做这个决定？", "走还是留", "如果离开，我最需要准备什么？"],
};
const SELF = ["", "", "中间那张让我有点不舒服", "第一张的颜色很温暖", "", "感觉被看穿了", "", "没什么感觉", "最后一张让我想起一个人", ""];

const cases = [];
for (const [topic, questions] of Object.entries(QUESTIONS)) {
  questions.forEach((question, i) => {
    const pool = [...ids];
    const cards = [0, 1, 2].map((position) => {
      const [cardId] = pool.splice(Math.floor(rand() * pool.length), 1);
      return { cardId, position, reversed: rand() < 0.4 };
    });
    cases.push({ id: `${topic}-${String(i + 1).padStart(2, "0")}`, topic, question, selfReading: SELF[i], cards });
  });
}

writeFileSync(`${root}evals/reading/cases.json`, JSON.stringify({ seed: 20261009, cases }, null, 1) + "\n");
console.log(`wrote ${cases.length} cases`);
