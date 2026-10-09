// 本地模式：不调用任何模型，用牌义 + 规则模板按"此刻 / 阻碍 / 下一步"组织解读。

import { z } from "zod";
import data from "../../../content/local-reading.json";
import { getCard, type Card } from "@/features/cards/cards";
import { TOPICS, type CardSide, type Topic } from "@/features/cards/schema";
import type { ReadingRequest, ReadingResult } from "./contract";
import { getSpread } from "./spread";

const topicMap = z.strictObject(Object.fromEntries(TOPICS.map((t) => [t, z.string().min(4)])) as Record<Topic, z.ZodString>);

const templateSchema = z.strictObject({
  intro: z.string(),
  selfReadingLead: z.string().includes("{self}"),
  lenses: z.tuple([
    z.strictObject({ label: z.string(), lead: z.string().includes("{obstacle}") }),
    z.strictObject({ label: z.string(), lead: z.string().includes("{obstacle}") }),
  ]),
  nextLead: z.string().includes("{next}"),
  reversedNote: z.string(),
  actions: z.strictObject({
    major: topicMap,
    wands: topicMap,
    cups: topicMap,
    swords: topicMap,
    pentacles: topicMap,
  }),
  reversedActionLead: z.string(),
  fallbackQuestion: z.string().endsWith("？"),
});

export const LOCAL_TEMPLATE = templateSchema.parse(data);

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function sideOf(card: Card, reversed: boolean): CardSide {
  return reversed ? card.reversed : card.upright;
}

function cardLabel(card: Card, reversed: boolean): string {
  return reversed ? `${card.nameZh}（逆位）` : card.nameZh;
}

/** 牌阵位置 → 叙述角色。三张牌阵按位置；其他牌阵（以后）首张为此刻、末张为下一步、中间为阻碍。 */
function roles(count: number) {
  return { situation: 0, obstacle: Math.min(1, count - 1), next: count - 1 };
}

export function buildLocalReading(request: ReadingRequest): ReadingResult {
  const spread = getSpread(request.spreadId);
  const T = LOCAL_TEMPLATE;
  const drawn = request.cards.map((c) => ({ ...c, card: getCard(c.cardId), side: sideOf(getCard(c.cardId), c.reversed) }));
  const r = roles(drawn.length);
  const topic = request.topic;

  const cards = drawn.map((d) => {
    const position = spread.positions[d.position];
    const parts = [d.side.meaning, `放在「${position.label}」上看：${d.side[topic]}`];
    if (d.reversed) parts.push(T.reversedNote);
    return { cardId: d.cardId, position: d.position, reversed: d.reversed, text: parts.join("") };
  });

  const summary = drawn
    .map((d) => `${spread.positions[d.position].label}——${cardLabel(d.card, d.reversed)}（${d.side.keywords.slice(0, 2).join("、")}）`)
    .join("；");
  const overallParts = [`${summary}。`, T.intro];
  if (request.selfReading) overallParts.unshift(fill(T.selfReadingLead, { self: request.selfReading }));

  const obstacle = drawn[r.obstacle];
  const next = drawn[r.next];
  const outerField: keyof CardSide = topic === "self" ? "meaning" : topic;
  const interpretations: [string, string] = [
    `${fill(T.lenses[0].lead, { obstacle: cardLabel(obstacle.card, obstacle.reversed) })}${obstacle.side[outerField]}${fill(T.nextLead, { next: cardLabel(next.card, next.reversed) })}${next.side.crossroads}`,
    `${fill(T.lenses[1].lead, { obstacle: cardLabel(obstacle.card, obstacle.reversed) })}${obstacle.side.self}${fill(T.nextLead, { next: cardLabel(next.card, next.reversed) })}${next.side.self}`,
  ];

  const group = next.card.suit ?? "major";
  const action = (next.reversed ? T.reversedActionLead : "") + T.actions[group][topic];

  return {
    source: "local",
    overall: overallParts.join(""),
    cards,
    interpretations,
    action,
    question: next.side.question || T.fallbackQuestion,
  };
}
