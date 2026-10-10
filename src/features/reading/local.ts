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
const obstacleSchema = z.strictObject({ focus: z.string().min(4), text: z.string().min(8), check: z.string().min(8) });
const actionsSchema = z.strictObject({ clarify: z.string().min(8), decide: z.string().min(8), companion: z.string().min(8) });
const nextSchema = z.strictObject({
  text: z.string().min(8),
  check: z.string().min(8),
  actions: actionsSchema,
  question: z.string().min(4).endsWith("？"),
});
/** 个别牌在某些主题下语境会错配（比如关系问题读成职场协作），可以给该主题单独写变体；没写就用默认。 */
const topicVariantSchema = z.strictObject({ gist: z.string().optional(), obstacle: obstacleSchema.optional(), next: z.strictObject({ text: z.string().optional(), check: z.string().optional(), actions: actionsSchema.optional(), question: z.string().optional() }).optional() });
const sideV2Schema = z.strictObject({
  gist: z.string().min(2),
  /** 编辑标记（不是从句子里猜出来的）：这个朝向带有哪些主题，用来选择共同解释；词表见各 focus 的 weights */
  tags: z.array(z.string().min(2)),
  situation: z.string().min(8),
  obstacle: obstacleSchema,
  next: nextSchema,
  byTopic: z.strictObject(Object.fromEntries(TOPICS.map((t) => [t, topicVariantSchema.optional()])) as Record<Topic, z.ZodOptional<typeof topicVariantSchema>>).optional(),
});
/**
 * 共同解释（focus）：先按三张牌的编辑标记选出一个主张，再围绕它渲染整体、两条读法、行动与追问。
 * weights 给每个标记在这个主张里的分量；至少两张牌有贡献且总分 ≥ need 才算命中，否则回到按位置组织的 v2.1 路径。
 */
const focusVariantSchema = z.strictObject({
  claim: z.string().optional(),
  roles: z.record(z.string(), z.strictObject({ relation: z.string(), detail: z.string() })).optional(),
  branches: z.tuple([z.string(), z.string()]).optional(),
  actions: actionsSchema.optional(),
  questions: z.record(z.string(), z.string()).optional(),
  stance: z.record(z.string(), z.string()).optional(),
});
const focusSchema = z.strictObject({
  id: z.string().min(2),
  claim: z.string().min(4),
  weights: z.record(z.string(), z.number().int().min(1)),
  need: z.number().int().min(1),
  /** 适用范围：至少一张牌带有这些标记之一才命中（比如“过渡”类主张要求有一张牌真的在讲过渡 / 收尾） */
  requireAny: z.array(z.string()).optional(),
  roles: z.record(z.string(), z.strictObject({ relation: z.string().min(4), detail: z.string().min(8) })),
  stance: z.strictObject({ clarify: z.string().min(4), decide: z.string().min(4), companion: z.string().min(4) }),
  branches: z.tuple([z.string().min(8), z.string().min(8)]),
  actions: actionsSchema,
  /** 个别主题下语境不同的行动（比如关系主题里“一起完成”要改成只涉及自己），没写就用 actions */
  topicActions: z.strictObject(Object.fromEntries(TOPICS.map((t) => [t, actionsSchema.optional()])) as Record<Topic, z.ZodOptional<typeof actionsSchema>>).optional(),
  questions: z.strictObject({ clarify: z.string().endsWith("？"), decide: z.string().endsWith("？"), companion: z.string().endsWith("？") }),
  /** 转折：末牌（“下一步”位置）带着与主张相反的标记时，补一句整体的转折，必要时换掉行动 */
  /** 主题变体：该主题下换掉主张的说法 / 牌说明 / 读法 / 行动 / 追问（没写的部分沿用默认） */
  topicVariants: z.partialRecord(z.enum(TOPICS), focusVariantSchema).optional(),
  /** 陪伴等意图下换一组读法 */
  intentBranches: z.record(z.string(), z.tuple([z.string(), z.string()])).optional(),
  /** 末牌（下一步）带着某个标记时，行动 / 追问按该标记换（让行动跟着最后一张牌，而不是千篇一律） */
  nextVariants: z.record(z.string(), z.strictObject({ actions: z.record(z.string(), z.string()).optional(), questions: z.record(z.string(), z.string()).optional() })).optional(),
  turns: z.array(z.strictObject({ whenNext: z.array(z.string()), overall: z.string().min(8), actions: actionsSchema.optional() })).optional(),
});
type Focus = z.infer<typeof focusSchema>;

const v2Schema = z.strictObject({
  version: z.string(),
  focuses: z.array(focusSchema),
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

type PickedFocus = { focus: Focus; roleTags: (string | null)[] };

function pickFocus(request: ReadingRequest): PickedFocus | null {
  const sides = [...request.cards].sort((a, b) => a.position - b.position).map((c) => v2Side(c.cardId, c.reversed)!);
  let best: { picked: PickedFocus; score: number } | null = null;
  for (const focus of LOCAL_V2.focuses) {
    // 每张牌取它在这个主张里分量最大的一个标记
    const roleTags = sides.map((side) => {
      let top: string | null = null;
      for (const tag of side.tags) if (focus.weights[tag] && (top === null || focus.weights[tag] > focus.weights[top])) top = tag;
      return top;
    });
    const contributing = roleTags.filter((t) => t !== null).length;
    const score = roleTags.reduce((sum, t) => sum + (t ? focus.weights[t] : 0), 0);
    if (focus.requireAny && !sides.some((side) => side.tags.some((t) => focus.requireAny!.includes(t)))) continue;
    if (contributing >= 2 && score >= focus.need && (!best || score > best.score)) best = { picked: { focus, roleTags }, score };
  }
  return best?.picked ?? null;
}

/** 这组牌命中哪个共同解释（没命中或没有 v2 内容返回 null）。供测试和人工审读时追查。 */
export function selectLocalFocus(request: ReadingRequest): string | null {
  return coveredV2(request) ? (pickFocus(request)?.focus.id ?? null) : null;
}

function buildFocused(request: ReadingRequest, { focus: base, roleTags }: PickedFocus): ReadingResult {
  const intent = request.intent ?? "clarify";
  const where = LOCAL_V2.locative[request.topic];
  const fillIn = (text: string) => text.replaceAll("{in}", where);
  const byPosition = [...request.cards].sort((a, b) => a.position - b.position);
  const sides = byPosition.map((c) => v2Side(c.cardId, c.reversed)!);
  const label = (i: number) => `${getCard(byPosition[i].cardId).nameZh}${byPosition[i].reversed ? "（逆位）" : ""}`;
  const fallbackText = (i: number) => (i === 0 ? sides[0].situation : i === 1 ? sides[1].obstacle.text : sides[2].next.text);

  // 主题变体覆盖默认；末牌的标记（nextVariants）再覆盖行动 / 追问，让行动跟着最后一张牌
  const variant = base.topicVariants?.[request.topic];
  const roles = { ...base.roles, ...variant?.roles };
  const lastVariant = sides[2].tags.map((t) => base.nextVariants?.[t]).find((v) => v !== undefined);
  const actions: Record<string, string> = { ...base.actions, ...base.topicActions?.[request.topic], ...variant?.actions, ...lastVariant?.actions };
  const questions: Record<string, string> = { ...base.questions, ...variant?.questions, ...lastVariant?.questions };
  const branches = base.intentBranches?.[intent] ?? variant?.branches ?? base.branches;
  const claim = variant?.claim ?? base.claim;

  const cards = byPosition.map((c, i) => {
    const role = roleTags[i] ? roles[roleTags[i]!] : undefined;
    return { cardId: c.cardId, position: c.position, reversed: c.reversed, text: fillIn(role ? role.detail : fallbackText(i)) };
  });
  const relation = byPosition
    .map((_, i) => {
      const role = roleTags[i] ? roles[roleTags[i]!] : undefined;
      return role ? `${label(i)}${role.relation}` : `${label(i)}带来「${sides[i].gist}」这一层背景`;
    })
    .join("，");

  // 末牌（下一步）的标记与主张相反时：补一句转折，并按需要换掉行动
  const nextTags = sides[2].tags;
  const turn = base.turns?.find((t) => t.whenNext.some((tag) => nextTags.includes(tag)));
  const action = fillIn(turn?.actions?.[intent] ?? actions[intent]);

  return {
    source: "local",
    overall: [request.selfReading ? fill(LOCAL_TEMPLATE.selfReadingLead, { self: request.selfReading }) : "", `这组牌的重点是${claim}。`, `${relation}。`, turn ? turn.overall : (variant?.stance?.[intent] ?? base.stance[intent])].join(""),
    cards,
    interpretations: [fillIn(branches[0]), fillIn(branches[1])],
    action,
    question: questions[intent],
  };
}

function buildV2(request: ReadingRequest): ReadingResult {
  const picked = pickFocus(request);
  if (picked) return buildFocused(request, picked);
  const intent = request.intent ?? "clarify";
  const topic = request.topic;
  const where = LOCAL_V2.locative[topic];
  const fillIn = (text: string) => text.replaceAll("{in}", where);
  const byPosition = [...request.cards].sort((a, b) => a.position - b.position);
  const [first, middle, last] = byPosition.map((c) => v2Side(c.cardId, c.reversed)!);

  // 主题变体：阻碍位 / 下一步里该主题单独写过的部分覆盖默认
  const gistOf = (side: SideV2) => side.byTopic?.[topic]?.gist ?? side.gist;
  const obstacle = { ...middle.obstacle, ...middle.byTopic?.[topic]?.obstacle };
  const nextVar = last.byTopic?.[topic]?.next;
  const next = { ...last.next, ...nextVar, actions: { ...last.next.actions, ...nextVar?.actions } };

  const cards = byPosition.map((c, i) => {
    const text = i === 0 ? first.situation : i === 1 ? obstacle.text : next.text;
    return { cardId: c.cardId, position: c.position, reversed: c.reversed, text: fillIn(text) };
  });

  const overall = [
    request.selfReading ? fill(LOCAL_TEMPLATE.selfReadingLead, { self: request.selfReading }) : "",
    `这组牌值得先核对的是：${obstacle.focus}。`,
    `这组牌里出现了「${gistOf(first)}」「${gistOf(middle)}」和「${gistOf(last)}」。`,
    LOCAL_V2.closing[intent].replaceAll("{focus}", obstacle.focus).replaceAll("{next}", gistOf(last)),
  ].join("");

  return {
    source: "local",
    overall,
    cards,
    interpretations: [fillIn(obstacle.check), fillIn(next.check)],
    // 行动由末牌的动作决定，再带上阻碍牌的核对点，让行动和整体判断连在一起
    action: fillIn(next.actions[intent]),
    question: next.question,
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
