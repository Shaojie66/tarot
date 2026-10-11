// 本地解读 v2 内容的覆盖进度：node scripts/local-coverage.mjs
// 读取 content/local-reading-v2.json、content/cards/*.json、docs/local-reading-expansion/{batches,reviews}.json，
// 打印摘要并重写 docs/local-reading-expansion/STATUS.md。覆盖率口径：普通随机三牌里“三张都有 v2 内容”的概率 = C(n,3)/C(78,3)，
// n = 两个朝向都写完的牌数。固定样本集的命中率不是覆盖率。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => JSON.parse(readFileSync(`${ROOT}${p}`, "utf8"));
const v2 = read("content/local-reading-v2.json");
const batches = read("docs/local-reading-expansion/batches.json").batches;
const reviews = read("docs/local-reading-expansion/reviews.json").reviews;
const SUITS = ["major", "wands", "cups", "swords", "pentacles"];
const SUIT_LABEL = { major: "大阿卡纳", wands: "权杖", cups: "圣杯", swords: "宝剑", pentacles: "星币" };

const cards = SUITS.flatMap((s) => read(`content/cards/${s}.json`).map((c) => ({ ...c, suit: s })));
const batchOf = new Map();
for (const b of batches) for (const id of b.cards) batchOf.set(id, b.id);

const sideOk = (side) => !!side && ["gist", "oneLine", "situation"].every((k) => typeof side[k] === "string") && Array.isArray(side.tags) && side.obstacle && side.next?.actions;
const covered = cards.filter((c) => sideOk(v2.cards[c.id]?.upright) && sideOk(v2.cards[c.id]?.reversed));
const choose3 = (n) => (n * (n - 1) * (n - 2)) / 6;
const route = choose3(covered.length) / choose3(cards.length);
const variantCount = (id) => ["upright", "reversed"].reduce((n, o) => n + Object.keys(v2.cards[id]?.[o]?.byTopic ?? {}).length, 0);

const lines = [];
lines.push("# 本地解读 v2 扩写进度", "", "> 由 `node scripts/local-coverage.mjs` 生成，不要手改。流程见 [PROCESS.md](PROCESS.md)，写作规范见 [STYLE.md](STYLE.md)。", "");
lines.push(`- 内容版本：\`${v2.version}\``);
lines.push(`- 已写完的牌：**${covered.length} / ${cards.length}**（${covered.length * 2} / ${cards.length * 2} 个朝向）`);
lines.push(`- 共同解释（focus）：${v2.focuses.length} 个：${v2.focuses.map((f) => f.id).join("、")}`);
lines.push(`- **普通随机三牌走新结构的概率** = C(${covered.length},3) / C(${cards.length},3) = **${(route * 100).toFixed(3)}%**（假设抽牌均匀；不是用户流量实测）`, "");
lines.push("## 批次", "", "| 批次 | 状态 | 牌 | 已写完 | AI 预审 | 人工评分 |", "|---|---|---|---|---|---|");
for (const b of batches) {
  const done = b.cards.filter((id) => covered.some((c) => c.id === id)).length;
  const r = reviews[String(b.id)];
  const names = b.cards.map((id) => cards.find((c) => c.id === id)?.nameZh ?? id).join("、");
  lines.push(`| ${b.id} | ${b.status} | ${names} | ${done}/${b.cards.length} | ${r?.aiPrescreen ? "有" : "无"} | ${r?.humanReview ? "有" : "**无**"} |`);
}
lines.push("", "## 逐牌", "");
for (const s of SUITS) {
  lines.push(`### ${SUIT_LABEL[s]}`, "", "| 牌 | 批次 | 正位 | 逆位 | 主题变体 |", "|---|---|---|---|---|");
  for (const c of cards.filter((x) => x.suit === s)) {
    const e = v2.cards[c.id];
    lines.push(`| ${c.nameZh} | ${batchOf.get(c.id) ?? "-"} | ${sideOk(e?.upright) ? "✓" : "—"} | ${sideOk(e?.reversed) ? "✓" : "—"} | ${variantCount(c.id) || ""} |`);
  }
  lines.push("");
}
writeFileSync(`${ROOT}docs/local-reading-expansion/STATUS.md`, lines.join("\n"));
console.log(`已写完 ${covered.length}/${cards.length} 张；路由覆盖 ${(route * 100).toFixed(3)}%；已写 ${lines.length} 行状态到 docs/local-reading-expansion/STATUS.md`);
