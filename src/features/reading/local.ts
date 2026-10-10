// 本地模式：不调用任何模型，用牌义 + 规则模板按"此刻 / 阻碍 / 下一步"组织解读。

import { z } from "zod";
import data from "../../../content/local-reading.json";
import dataV2 from "../../../content/local-reading-v2.json";
import { getCard, type Card } from "@/features/cards/cards";
import { isCardId } from "@/features/cards/ids";
import { TOPICS, type CardSide, type Topic } from "@/features/cards/schema";
import { CONTENT_VERSION, type ReadingRequest, type ReadingResult } from "./contract";
import { getSpread } from "./spread";

const topicMap = z.strictObject(Object.fromEntries(TOPICS.map((t) => [t, z.string().min(4)])) as Record<Topic, z.ZodString>);

const intentSchema = z.strictObject({
  intro: z.string(),
  lensLeads: z.tuple([z.string().includes("{obstacle}"), z.string().includes("{obstacle}")]),
  nextLead: z.string().includes("{next}"),
  question: z.string().min(4).endsWith("？"),
  actions: topicMap,
});

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
  /** 按“这次想要的帮助”换语气；没有 intent 或 clarify 用上面的默认 */
  intents: z.strictObject({ decide: intentSchema, companion: intentSchema }),
  reversedActionLead: z.string(),
  fallbackQuestion: z.string().endsWith("？"),
});

export const LOCAL_TEMPLATE = templateSchema.parse(data);

// ── v2：经过编辑的牌面内容（content/local-reading-v2.json）。
// 每张牌的每个朝向都写了：在“此刻 / 阻碍 / 下一步”三个位置上的贡献、两条核对路径的条件句、三种意图的行动和一个追问。
// 三张牌都有 v2 内容才使用；缺任何一张就整体回退到上面的 v1 模板（不拼半新半旧）。
// 本地规则不读取问题正文；问题和自解只作为用户自己的记录展示。
const sideV2Schema = z.strictObject({
  gist: z.string().min(2),
  situation: z.string().min(8),
  obstacle: z.strictObject({ focus: z.string().min(4), text: z.string().min(8), check: z.string().min(8) }),
  next: z.strictObject({
    text: z.string().min(8),
    check: z.string().min(8),
    actions: z.strictObject({ clarify: z.string().min(8), decide: z.string().min(8), companion: z.string().min(8) }),
    question: z.string().min(4).endsWith("？"),
  }),
});
const v2Schema = z.strictObject({
  version: z.string(),
  locative: z.strictObject(Object.fromEntries(TOPICS.map((t) => [t, z.string().min(2)])) as Record<Topic, z.ZodString>),
  closing: z.strictObject({ clarify: z.string(), decide: z.string(), companion: z.string() }),
  cards: z.record(z.string().refine(isCardId, "unknown card id"), z.strictObject({ upright: sideV2Schema, reversed: sideV2Schema })),
});
export const LOCAL_V2 = v2Schema.parse(dataV2);
type SideV2 = z.infer<typeof sideV2Schema>;

function v2Side(cardId: string, reversed: boolean): SideV2 | undefined {
  const entry = (LOCAL_V2.cards as Record<string, { upright: SideV2; reversed: SideV2 }>)[cardId];
  return entry ? (reversed ? entry.reversed : entry.upright) : undefined;
}

function coveredV2(request: ReadingRequest): boolean {
  return request.cards.length === 3 && request.cards.every((c) => v2Side(c.cardId, c.reversed) !== undefined);
}

/** 本地解读用到的内容版本：这组牌走了 v2 就带上标记，旧记录的快照不受影响。 */
export function localContentVersion(request: ReadingRequest): string {
  return coveredV2(request) ? `${CONTENT_VERSION}+${LOCAL_V2.version}` : CONTENT_VERSION;
}

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

function buildV2(request: ReadingRequest): ReadingResult {
  const intent = request.intent ?? "clarify";
  const where = LOCAL_V2.locative[request.topic];
  const fillIn = (text: string) => text.replaceAll("{in}", where);
  const byPosition = [...request.cards].sort((a, b) => a.position - b.position);
  const [first, middle, last] = byPosition.map((c) => v2Side(c.cardId, c.reversed)!);

  const cards = byPosition.map((c, i) => {
    const side = [first, middle, last][i];
    const text = i === 0 ? side.situation : i === 1 ? side.obstacle.text : side.next.text;
    return { cardId: c.cardId, position: c.position, reversed: c.reversed, text: fillIn(text) };
  });

  const overall = [
    request.selfReading ? fill(LOCAL_TEMPLATE.selfReadingLead, { self: request.selfReading }) : "",
    `这组牌的重点是${middle.obstacle.focus}。`,
    `从「${first.gist}」出发，卡在「${middle.gist}」，下一步指向「${last.gist}」。`,
    LOCAL_V2.closing[intent],
  ].join("");

  return {
    source: "local",
    overall,
    cards,
    interpretations: [fillIn(middle.obstacle.check), fillIn(last.next.check)],
    action: fillIn(last.next.actions[intent]),
    question: last.next.question,
  };
}

export function buildLocalReading(request: ReadingRequest, options: { legacy?: boolean } = {}): ReadingResult {
  if (!options.legacy && coveredV2(request)) return buildV2(request);
  const spread = getSpread(request.spreadId);
  const T = LOCAL_TEMPLATE;
  const tone = request.intent === "decide" || request.intent === "companion" ? T.intents[request.intent] : null;
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
  const overallParts = [`${summary}。`, tone?.intro ?? T.intro];
  if (request.selfReading) overallParts.unshift(fill(T.selfReadingLead, { self: request.selfReading }));

  const obstacle = drawn[r.obstacle];
  const next = drawn[r.next];
  const outerField: keyof CardSide = topic === "self" ? "meaning" : topic;
  const interpretations: [string, string] = [
    `${fill(tone?.lensLeads[0] ?? T.lenses[0].lead, { obstacle: cardLabel(obstacle.card, obstacle.reversed) })}${obstacle.side[outerField]}${fill(tone?.nextLead ?? T.nextLead, { next: cardLabel(next.card, next.reversed) })}${next.side.crossroads}`,
    `${fill(tone?.lensLeads[1] ?? T.lenses[1].lead, { obstacle: cardLabel(obstacle.card, obstacle.reversed) })}${obstacle.side.self}${fill(tone?.nextLead ?? T.nextLead, { next: cardLabel(next.card, next.reversed) })}${next.side.self}`,
  ];

  const group = next.card.suit ?? "major";
  const action = (next.reversed ? T.reversedActionLead : "") + (tone ? tone.actions[topic] : T.actions[group][topic]);

  return {
    source: "local",
    overall: overallParts.join(""),
    cards,
    interpretations,
    action,
    question: tone?.question ?? (next.side.question || T.fallbackQuestion),
  };
}
