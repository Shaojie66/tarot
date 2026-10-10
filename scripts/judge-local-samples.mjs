// 用 OpenAI 兼容接口的模型（如 DeepSeek）给“本地解读盲看样本”打分，做跨模型的交叉检验。
// 用法：OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.deepseek.com OPENAI_MODEL=deepseek-chat \
//        node scripts/judge-local-samples.mjs docs/local-reading-samples-local-v2.5-sample-vs-v2.1.md
// 评审模型只看到盲看文档（版本顺序已打乱）；对照表只在拿到全部打分之后才读来还原版本。
// 这仍是 AI 预审，不是人工评分；结果写到 tmp/evals/（gitignore）。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const docPath = process.argv[2];
if (!docPath) throw new Error("需要盲看文档路径");
const keyPath = docPath.replace("local-reading-samples-", "local-reading-samples-key-");
const base = (process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
const model = process.env.OPENAI_MODEL ?? "deepseek-chat";
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("需要 OPENAI_API_KEY");

const doc = readFileSync(`${ROOT}${docPath}`, "utf8");

const RUBRIC = `评分（每版本每项 0–2：0=缺失或明显问题，1=部分达到，2=清楚有用）：
1 观点明确：看完首段能否说出“这次建议优先看什么”；2 三牌关联：三张牌都对判断有贡献，整体、读法、行动、问句讲同一件事；3 主题匹配：事业/关系/自我/去留各自贴合；4 行动具体：有对象、步骤或完成标准，与整体重点连得上；5 语言直接：不重复免责、不机械套话、不说教，且不对用户没提供的事实装作知道。
每个样本：两版各打 5 项，选偏好（"1"/"2"/"tie"），一句话理由（引用具体句子）；某版本在某一项上比另一个更差时，在理由里写“退步：…”。两个版本都是同一产品的迭代，哪个更新未知，不要猜；内容几乎相同时偏好写 tie。16 个样本都要评。
只输出一个 JSON 对象：{"samples":[{"n":1,"v1":{"opinion":0,"cards":0,"topic":0,"action":0,"language":0},"v2":{...},"prefer":"1","reason":"..."}, ...共16项]}。不要输出 JSON 以外的任何文字。`;

const PERSPECTIVES = [
  ["目标用户", "你是一名独立评审，对一份中文塔罗反思工具的“本地解读”两个相邻迭代做盲评。你的视角：一个成年早期、深夜独自在手机上使用的真实用户，关心读完是否有用、是否像在认真回答我、是否被说教或敷衍、是否被替我断言了我没说过的事。"],
  ["文案编辑", "你是一名独立评审，对一份中文塔罗反思工具的“本地解读”两个相邻迭代做盲评。你的视角：资深中文文案编辑，关注是否有明确主张、论证是否站得住、句子是否有信息量、整体与读法与行动与问句是否在讲同一件事、是否读起来像模板拼接、同一套行动是否在多个样本里雷同。"],
  ["风险审查", "你是一名独立评审，对一份中文塔罗反思工具的“本地解读”两个相邻迭代做盲评。你的视角：产品安全与内容风险审查员。红线：不预测具体事件、不用断言式用语、不凭牌面替用户确认处境/情绪/他人动机/关系结论/用户做过的事、不替用户做决定、不默认紧急事项可以拖延（延期类建议要有“不紧急”或期限例外）、行动涉及关系时不预设联系对方、不预设用户要离开某个状态；明确的条件句不算断言；也要判断“什么都不敢说”的相反毛病。"],
];

async function ask(system) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.3, max_tokens: 8000, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: doc }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

const results = {};
for (const [name, persona] of PERSPECTIVES) {
  let out;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    try {
      out = await ask(`${persona}\n\n${RUBRIC}`);
      if (!Array.isArray(out.samples) || out.samples.length !== 16) throw new Error(`样本数 ${out.samples?.length}`);
    } catch (e) {
      console.error(`[${name}] 第 ${attempt + 1} 次失败：${e.message}`);
      out = undefined;
    }
  }
  results[name] = out ?? null;
}

// 打分完成后才读对照表
const key = readFileSync(`${ROOT}${keyPath}`, "utf8");
const candidateIsV1 = {};
for (const line of key.split("\n")) {
  const m = line.match(/^\| (\d+) \| \S+ \| 版本 1 = (候选|v2\.1)/);
  if (m) candidateIsV1[Number(m[1])] = m[2] === "候选";
}
const DIMS = ["opinion", "cards", "topic", "action", "language"];
const summary = {};
for (const [name, out] of Object.entries(results)) {
  if (!out) { summary[name] = "未得到有效结果"; continue; }
  const w = { 候选: 0, "v2.1": 0, 平: 0 };
  const sum = { 候选: [0, 0, 0, 0, 0], "v2.1": [0, 0, 0, 0, 0] };
  const v21Wins = [];
  for (const s of out.samples) {
    const cand = candidateIsV1[s.n] ? s.v1 : s.v2;
    const old = candidateIsV1[s.n] ? s.v2 : s.v1;
    DIMS.forEach((d, i) => { sum.候选[i] += Number(cand?.[d] ?? 0); sum["v2.1"][i] += Number(old?.[d] ?? 0); });
    if (s.prefer === "tie") w.平++;
    else {
      const win = (s.prefer === "1") === candidateIsV1[s.n] ? "候选" : "v2.1";
      w[win]++;
      if (win === "v2.1") v21Wins.push(s.n);
    }
  }
  const avg = (a) => a.map((x) => Math.round((x / 16) * 100) / 100);
  summary[name] = { 偏好: w, 平均分: { 候选: avg(sum.候选), "v2.1": avg(sum["v2.1"]) }, v2_1胜出的样本: v21Wins };
}
mkdirSync(`${ROOT}tmp/evals`, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`${ROOT}tmp/evals/local-judge-${model}-${stamp}.json`, JSON.stringify({ meta: { model, base: new URL(base).host, doc: docPath, date: new Date().toISOString() }, summary, results }, null, 2));
console.log(JSON.stringify({ model, doc: docPath, summary }, null, 1));
