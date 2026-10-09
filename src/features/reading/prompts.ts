// 版本化 prompt 的加载与拼装。只在服务端使用。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCard } from "@/features/cards/cards";
import { TOPIC_LABELS, type Topic } from "@/features/cards/schema";
import type { ReadingRequest } from "./contract";
import { getSpread } from "./spread";

export const PROMPT_VERSION = "v2";

const cache = new Map<string, string>();

function load(name: string): string {
  const key = `${PROMPT_VERSION}/${name}`;
  if (!cache.has(key)) {
    cache.set(key, readFileSync(join(process.cwd(), "content", "prompts", PROMPT_VERSION, name), "utf8").trim());
  }
  return cache.get(key)!;
}

export function readingSystemPrompt(): string {
  return load("reading-system.md");
}

export function rewriteSystemPrompt(): string {
  return load("rewrite-system.md");
}

export function readingUserPrompt(request: ReadingRequest): string {
  const spread = getSpread(request.spreadId);
  const cards = request.cards.map((drawn) => {
    const card = getCard(drawn.cardId);
    const side = drawn.reversed ? card.reversed : card.upright;
    const position = spread.positions[drawn.position];
    return [
      `### 位置 ${drawn.position}：${position.label}（${position.hint}）`,
      `cardId: ${drawn.cardId} | position: ${drawn.position} | reversed: ${drawn.reversed}`,
      `${card.nameZh}（${card.nameEn}）${drawn.reversed ? "逆位" : "正位"}，关键词：${side.keywords.join("、")}`,
      `牌义：${side.meaning}`,
      `在「${TOPIC_LABELS[request.topic]}」主题下：${side[request.topic]}`,
      `牌面附带的反思问题：${side.question}`,
    ].join("\n");
  });
  return [
    `## 牌阵：${spread.name}`,
    `主题：${TOPIC_LABELS[request.topic]}`,
    `用户的问题：${request.question}`,
    request.selfReading ? `用户看到牌后的第一反应（自解）：${request.selfReading}` : "用户没有填写自解。",
    "",
    "## 抽到的牌（顺序与位置已固定）",
    ...cards,
  ].join("\n");
}

export function rewriteUserPrompt(question: string, topic: Topic): string {
  return `主题：${TOPIC_LABELS[topic]}\n用户的问题：${question}`;
}
