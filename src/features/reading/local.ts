// 本地模式：不调用任何模型，用牌义 + 规则模板按"此刻 / 阻碍 / 下一步"组织解读。

import { z } from "zod";
import data from "../../../content/local-reading.json";
import dataV2 from "../../../content/local-reading-v2.json";
import dataContract from "../../../content/local-reading-v2-contract.json";
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
  /** 这张牌在“下一步”位置给的方向（动词短语，不带句号）。按位置路径的整体用它收尾，让行动和追问有来处 */
  aim: z.string().min(4).refine((v) => !v.includes("。"), "aim 是短语，不带句号"),
  text: z.string().min(8),
  check: z.string().min(8),
  actions: actionsSchema,
  question: z.string().min(4).endsWith("？"),
});
/** 个别牌在某些主题下语境会错配（比如关系问题读成职场协作），可以给该主题单独写变体；没写就用默认。 */
const topicVariantSchema = z.strictObject({ gist: z.string().optional(), oneLine: z.string().startsWith("可能").optional(), situation: z.string().min(8).optional(), obstacle: obstacleSchema.optional(), next: z.strictObject({ aim: z.string().min(4).optional(), text: z.string().optional(), check: z.string().optional(), actions: actionsSchema.optional(), question: z.string().endsWith("？").optional() }).optional() });
const sideV2Schema = z.strictObject({
  gist: z.string().min(2),
  /** 一句话要点（以“可能……”开头的谓语），用在整体里综合三张牌；与逐牌说明是不同的句子，避免整体抄逐牌说明 */
  oneLine: z.string().min(4).startsWith("可能"),
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
  /** 这些意图下不适用（比如陪伴时没有要做的决定，“做决定与做试验”就不成立），回到按位置的路径 */
  excludeIntents: z.array(z.string()).optional(),
  /** 适用范围：至少一张牌带有这些标记之一才命中（比如“过渡”类主张要求有一张牌真的在讲过渡 / 收尾；后备主张用它指定“锚牌”） */
  requireAny: z.array(z.string()).optional(),
  /** 后备主张：只在非后备主张都不命中时才参与选择，不抢原来命中的组合（v2.10；牌和主张多起来之后要换成统一的打分规则） */
  fallback: z.boolean().optional(),
  roles: z.record(z.string(), z.strictObject({ relation: z.string().min(4), detail: z.string().min(8) })),
  /**
   * 衔接：这张牌的标记不在 weights 里（不参与选主张）时，按标记给一句它对主张的作用，必要时换掉它的说明。
   * 没写就用这张牌自己的一句话要点。加减 support 不改变命中分布。
   */
  support: z.record(z.string(), z.strictObject({ relation: z.string().min(4), detail: z.string().min(8).optional() })).optional(),
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
  nextVariants: z.record(z.string(), z.strictObject({ actions: z.record(z.string(), z.string()).optional(), questions: z.record(z.string(), z.string()).optional(), branches: z.tuple([z.string(), z.string()]).optional() })).optional(),
  turns: z.array(z.strictObject({ whenNext: z.array(z.string()), overall: z.string().min(8), actions: actionsSchema.optional() })).optional(),
});
// 后备主张只组织重点与关系；读法、行动、追问由下面的核对契约（content/local-reading-v2-contract.json）构造，
// 不接受任何通用读法、行动、立场或按标签取的变体字段。
const fallbackFocusSchema = focusSchema.pick({ id: true, claim: true, weights: true, need: true, excludeIntents: true, roles: true, support: true }).extend({
  fallback: z.literal(true),
  requireAny: z.array(z.string()).min(1),
  /** v2.13 陪伴：整体只说这一句主张（不渲染逐牌关系句，关系句带分析口气），不分主题 */
  companionClaim: z.string().min(6).refine((v) => !/[。？]/.test(v) && !/是否|有没有|还是|判断|分清|确认/.test(v), "陪伴主张不带标点、不要求判断").optional(),
  topicVariants: z.partialRecord(z.enum(TOPICS), focusVariantSchema.pick({ claim: true, roles: true })).optional(),
});
const primaryFocusSchema = focusSchema.extend({ fallback: z.literal(false).optional() });
const anyFocusSchema = z.union([primaryFocusSchema, fallbackFocusSchema]);
type Focus = z.infer<typeof anyFocusSchema>;

const v2Schema = z.strictObject({
  version: z.string(),
  focuses: z.array(anyFocusSchema),
  locative: z.strictObject(Object.fromEntries(TOPICS.map((t) => [t, z.string().min(2)])) as Record<Topic, z.ZodString>),
  /** 按位置路径的整体收尾：把末牌的方向（next.aim）交代出来，行动和追问落在这一步上 */
  closing: z.strictObject({ clarify: z.string().includes("{aim}"), decide: z.string().includes("{aim}"), companion: z.string().includes("{aim}") }),
  cards: z.record(z.string().refine(isCardId, "unknown card id"), z.strictObject({ upright: sideV2Schema, reversed: sideV2Schema })),
});
export const LOCAL_V2 = v2Schema.parse(dataV2);
type SideV2 = z.infer<typeof sideV2Schema>;

function v2Side(cardId: string, reversed: boolean): SideV2 | undefined {
  const entry = (LOCAL_V2.cards as Record<string, { upright: SideV2; reversed: SideV2 }>)[cardId];
  return entry ? (reversed ? entry.reversed : entry.upright) : undefined;
}

/** 这个朝向在某主题下实际使用的内容：主题变体覆盖默认（没写的部分沿用默认）。 */
function resolveSide(side: SideV2, topic: Topic) {
  const variant = side.byTopic?.[topic];
  return {
    oneLine: variant?.oneLine ?? side.oneLine,
    situation: variant?.situation ?? side.situation,
    obstacle: { ...side.obstacle, ...variant?.obstacle },
    next: { ...side.next, ...variant?.next, actions: { ...side.next.actions, ...variant?.next?.actions } },
  };
}

// ── 核对契约（v2.12）：后备路径的读法一、行动、追问由两张牌的槽构造。
// 阻碍位牌写“核对什么、凭什么算数、怎样观察”（object / standard / probe）；末牌只写做法的方式、分量和何时停（frame / stop），
// 行动里出现的对象因此只可能来自阻碍位，读法和行动不会各说各的。
/**
 * v2.13 观察方式：回看一次具体经历 / 做一次可撤回的小试 / 查证一处事实 / 说出来或写下来 / 停一拍过一晚（今晚先写一句）/ 先减掉一项；
 * 以及三种“停下来”的方式（今晚不碰事情本身，只换一个角度看一眼）：歇（醒后最先自己冒出来的是什么）/ 补（哪一部分最耗劲）/ 缓（把事实和担心分开）。
 */
export const MODES = ["recall", "trial", "check", "say", "pause", "drop", "rest", "refuel", "settle"] as const;
export type Mode = (typeof MODES)[number];
const intentTexts = (marker: string) => z.strictObject({ clarify: z.string().includes(marker), decide: z.string().includes(marker), companion: z.string().includes(marker) });
const obstacleSlotSchema = z.strictObject({
  /** 要核对的那件事（名词短语，可带 {in}） */
  object: z.string().min(4),
  /** 判断标准：一个能回答“是 / 否”的从句，同时用作追问 */
  standard: z.string().min(6).regex(/是否|有没有|还是|够不够|对得上|跟得上/, "standard 要能回答是 / 否"),
  /** 最小观察动作（动词短语，不带句号、不带时间；时间和分量由末牌的 frame 给） */
  probe: z.string().min(6).refine((v) => !v.includes("。"), "probe 是短语，不带句号"),
  /** 陪伴版：只观察，不产出 */
  probeLight: z.string().min(6).refine((v) => !v.includes("。"), "probeLight 是短语，不带句号"),
  // ── v2.13 小样槽（可选；缺任一项时该意图回到 v2.12 写法）
  /** 理清：按观察方式各写一句动作（含停止句），产出必须能回答本条 standard；用不上的方式不写 */
  modes: z.partialRecord(z.enum(MODES), z.string().min(12).endsWith("。").refine((v) => !/往往就是|可能就是|一定|注定/.test(v), "不替用户下断语")).refine((m) => Object.keys(m).length >= 3, "至少写 3 种方式，否则换末牌不起作用").optional(),
  /** 决定：对每个选项问同一句的比较标准（“哪个选项……”，不带问号） */
  compare: z.string().min(6).startsWith("哪个选项").refine((v) => !/[。？]/.test(v), "compare 不带句号或问号").optional(),
  /** 决定：读法一，只陈述这把尺子，不布置任务 */
  compareLens: z.string().min(12).endsWith("。").refine((v) => !/写下|写一句|列出|记下|先给|先让/.test(v), "compareLens 不布置任务").optional(),
  /** 决定：按观察方式各写一句“在每个选项上怎么看”（含停止句），产出必须能回答本条 compare */
  compareModes: z.partialRecord(z.enum(MODES), z.string().includes("每个选项").endsWith("。").refine((v) => !/往往就是|可能就是|一定|注定/.test(v), "不替用户下断语")).refine((m) => Object.keys(m).length >= 3, "至少写 3 种方式").optional(),
  /** 决定：末牌选的方式本条都没写时，用这句收集，含 {compare} 和停止句 */
  gather: z.string().includes("每个选项").includes("{compare}").endsWith("。").optional(),
  /** 理清 / 决定的桥接用：条件式引子，“如果……，先看……”，不把用户的处境写成已知；末尾说出读法一标准所指的那样东西 */
  objectIf: z.string().startsWith("如果").includes("先看").refine((v) => !/[。？]/.test(v), "objectIf 不带句末标点").optional(),
  /** 理清 / 决定：阻碍位逐牌说明，写这张牌“挡在哪里”（不写成建议），与 objectIf 说的是同一件事 */
  blocks: z.string().startsWith("挡住的").endsWith("。").optional(),
  /** 陪伴：条件式的一句，不预设用户有这件事，不要求判断 */
  light: z.string().min(8).startsWith("如果").endsWith("。").optional(),
});
const contractNextSchema = z.strictObject({
  /** 只描述姿态，不命名要核对的对象 */
  aim: nextSchema.shape.aim,
  /** 末牌给的方向说明，只许引用 {object} */
  reading: z.string().min(8).endsWith("。"),
  frame: intentTexts("{probe}"),
  stop: z.strictObject({ clarify: z.string().min(4), decide: z.string().min(4), companion: z.string().min(4) }),
  // ── v2.13 小样槽（可选）：末牌选观察方式（首选在前），动作由阻碍位按方式写
  modes: z.array(z.enum(MODES)).min(1).max(3).optional(),
  /** 每种声明的方式配一句读法二，选中哪种就用哪句（行动与读法二不分家） */
  readings: z.partialRecord(z.enum(MODES), z.string().min(8).startsWith("末牌在提示").endsWith("。").refine((v) => !/往往|可能就是|一定|注定/.test(v), "读法二不下断语")).optional(),
  /** 决定：没有可用方式时接在收集句前的节奏（如“先歇一会儿，状态好了再”），休息型末牌用 */
  gatherLead: z.string().min(4).endsWith("再").optional(),
  /** 陪伴：低负担的行动（含一次拒绝出口）与整体收尾的语气 */
  lightAct: z.string().min(8).startsWith("如果愿意").endsWith("。").optional(),
  /** 只写语气，不写动作（否则会渲染成“牌面的语气是：动手之前……”） */
  lightAim: z.string().min(4).max(16).refine((v) => !/[。？]/.test(v) && !/之前|找出|动手|把|给|选/.test(v), "lightAim 只写语气，不写动作").optional(),
  /** 陪伴：覆盖通用追问（行动把注意力移开主题时用，如“不处理任何事”） */
  lightQuestion: z.string().min(8).endsWith("？").optional(),
  /** 陪伴时替换 reading（原句带任务时才写） */
  lightReading: z.string().min(8).startsWith("末牌在提示").endsWith("。").optional(),
});
const sideKeySchema = z.string().refine((k) => /^[a-z0-9-]+\/(upright|reversed)$/.test(k) && isCardId(k.split("/")[0]), "unknown side key");
const contractSchema = z.strictObject({
  version: z.string(),
  templates: z.strictObject({
    reading: intentTexts("{object}"),
    closing: z.strictObject({ clarify: z.string().includes("{object}").includes("{aim}"), decide: z.string().includes("{object}").includes("{aim}"), companion: z.string().includes("{object}").includes("{aim}") }),
    question: intentTexts("{standard}"),
    companionCard: z.string().includes("{oneLine}"),
    // v2.13 小样模板
    compareClosing: z.string().min(8).endsWith("。"),
    /** v2.13 理清收尾：不复述对象（避免预设），也不带末牌方向（末牌方向可能与所选方式冲突） */
    clarifyClosing13: z.string().min(6).endsWith("。"),
    /** v2.13 理清读法一：对象已由整体的桥接句点出，这里只说标准，避免同一对象连说三遍 */
    clarifyReading13: z.string().includes("{standard}"),
    /** v2.13 理清 / 决定：整体末句，按命中的后备主张把重点接到阻碍位的对象上；只接对象，不另起要看的方面（那由读法一的标准给） */
    bridge: z.strictObject({ "inner-first": z.string().includes("{objectIf}"), rebuild: z.string().includes("{objectIf}"), "momentum-check": z.string().includes("{objectIf}") }),
    lightClosing: z.string().includes("{lightAim}"),
    lightQuestion: z.string().includes("{noun}").endsWith("？"),
    /** 决定：没有可用方式、改用阻碍位收集句时的读法二（末牌原句带方式，会和收集句对不上） */
    gatherReading: z.string().startsWith("末牌在提示").includes("{lightAim}").endsWith("。"),
    lightNoun: z.strictObject(Object.fromEntries(TOPICS.map((t) => [t, z.string().min(2)])) as Record<Topic, z.ZodString>),
  }),
  /** v2.13：陪伴时逐牌说明用的画面句（按朝向，不分位置）；没写的朝向用一句话要点，不加固定后缀 */
  image: z.record(sideKeySchema, z.string().min(8).endsWith("。")).default({}),
  /** 主题条目必须四个槽写全，不从默认补漏 */
  obstacle: z.record(
    sideKeySchema,
    obstacleSlotSchema.extend({ byTopic: z.partialRecord(z.enum(TOPICS), obstacleSlotSchema).optional() }).superRefine((o, ctx) => {
      // 主条写了 v2.13 槽，主题条目也必须写全：主题条目整组替换主条，缺了会静默退回 v2.12
      const keys = (["modes", "compareModes", "compare", "compareLens", "gather", "light", "objectIf", "blocks"] as const).filter((k) => o[k] !== undefined);
      for (const [topic, slot] of Object.entries(o.byTopic ?? {})) for (const k of keys) if (slot[k] === undefined) ctx.addIssue({ code: "custom", message: `byTopic.${topic} 缺 ${k}` });
    }),
  ),
  next: z.record(
    sideKeySchema,
    contractNextSchema.superRefine((n, ctx) => {
      for (const m of n.modes ?? []) if (!n.readings?.[m]) ctx.addIssue({ code: "custom", message: `modes 含 ${m}，缺 readings.${m}` });
    }),
  ),
});
export const LOCAL_CONTRACT = contractSchema.parse(dataContract);
const sideKey = (cardId: string, reversed: boolean) => `${cardId}/${reversed ? "reversed" : "upright"}`;

/** 后备路径这次用的写法：v2.13 小样槽齐全时为 "v2.13"，否则沿用 v2.12。供测试和审读追查。 */
export type FallbackLens = "v2.13" | "v2.12";

function contractEntries(request: ReadingRequest, byPosition: ReadingRequest["cards"]) {
  const mid = byPosition[1], last = byPosition[2];
  const obstacleEntry = LOCAL_CONTRACT.obstacle[sideKey(mid.cardId, mid.reversed)];
  const nextEntry = LOCAL_CONTRACT.next[sideKey(last.cardId, last.reversed)];
  if (!obstacleEntry || !nextEntry) throw new Error(`missing contract: ${sideKey(mid.cardId, mid.reversed)} / ${sideKey(last.cardId, last.reversed)}`);
  return { o: obstacleEntry.byTopic?.[request.topic] ?? obstacleEntry, n: nextEntry };
}

/** 末牌首选、阻碍位写了的那种观察方式；都没有时为 null（整格退回 v2.12） */
function modeOf(o: ReturnType<typeof contractEntries>["o"], n: ReturnType<typeof contractEntries>["n"], table: "modes" | "compareModes" = "modes"): Mode | null {
  return n.modes?.find((m) => o[table]?.[m] !== undefined) ?? null;
}

function lensOf(intent: NonNullable<ReadingRequest["intent"]>, o: ReturnType<typeof contractEntries>["o"], n: ReturnType<typeof contractEntries>["n"]): FallbackLens {
  if (intent === "clarify") return modeOf(o, n) ? "v2.13" : "v2.12";
  if (intent === "decide") return o.compare && o.compareLens && o.gather && n.modes ? "v2.13" : "v2.12";
  return o.light && n.lightAct && n.lightAim ? "v2.13" : "v2.12";
}

/** 理清 / 决定各用了哪种观察方式；决定没有可用方式时为 "gather"。供测试和审读追查。 */
export function selectFallbackMode(request: ReadingRequest): { clarify: Mode | null; decide: Mode | "gather" | null } | null {
  const picked = coveredV2(request) ? pickFocus(request) : null;
  if (!picked?.focus.fallback) return null;
  const { o, n } = contractEntries(request, [...request.cards].sort((a, b) => a.position - b.position));
  return { clarify: modeOf(o, n), decide: o.gather && n.modes ? (modeOf(o, n, "compareModes") ?? "gather") : null };
}

/** 这组牌走后备主张时用哪种写法（不走后备返回 null）。 */
export function selectFallbackLens(request: ReadingRequest): FallbackLens | null {
  const picked = coveredV2(request) ? pickFocus(request) : null;
  if (!picked?.focus.fallback) return null;
  const byPosition = [...request.cards].sort((a, b) => a.position - b.position);
  const { o, n } = contractEntries(request, byPosition);
  return lensOf(request.intent ?? "clarify", o, n);
}

function fallbackParts(request: ReadingRequest, byPosition: ReadingRequest["cards"], focusId: string) {
  const intent = request.intent ?? "clarify";
  const { o, n: nextEntry } = contractEntries(request, byPosition);
  const where = LOCAL_V2.locative[request.topic];
  const fillIn = (text: string) => text.replaceAll("{in}", where);
  const T = LOCAL_CONTRACT.templates;
  const slots = { object: fillIn(o.object), standard: fillIn(o.standard), aim: fillIn(nextEntry.aim), probe: fillIn(intent === "companion" ? o.probeLight : o.probe), objectIf: fillIn(o.objectIf ?? "") };
  const lens = lensOf(intent, o, nextEntry);
  const blocks = lens === "v2.13" && intent !== "companion" && o.blocks ? fillIn(o.blocks) : undefined;
  if (lens === "v2.13") {
    // 对象和标准来自阻碍位，动作的方式由末牌决定；陪伴不渲染 standard / probe
    if (intent === "clarify") {
      // 动作由阻碍位按末牌选的方式写，产出回答本条标准；末牌换的是观察方式
      const m = modeOf(o, nextEntry)!;
      const bridge = o.objectIf ? T.bridge[focusId as keyof typeof T.bridge] : undefined;
      return { lens, blocks, reading: [bridge ? fill(T.clarifyReading13, slots) : fill(T.reading.clarify, slots), nextEntry.readings![m]!] as [string, string], closing: bridge ? fill(bridge, slots) : T.clarifyClosing13, action: fillIn(o.modes![m]!), question: fill(T.question.clarify, slots) };
    }
    if (intent === "decide") {
      const c = { compare: fillIn(o.compare!), aim: slots.aim };
      // 末牌选方式，阻碍位按方式写“在每个选项上怎么看”；都没写时用阻碍位的收集句
      const m = modeOf(o, nextEntry, "compareModes");
      const text = m ? o.compareModes![m]! : (nextEntry.gatherLead ?? "") + o.gather!;
      return { lens, blocks, reading: [fillIn(o.compareLens!), m ? nextEntry.readings![m]! : fill(T.gatherReading, { lightAim: nextEntry.lightAim ?? "" })] as [string, string], closing: o.objectIf && T.bridge[focusId as keyof typeof T.bridge] ? fill(T.bridge[focusId as keyof typeof T.bridge], slots) : T.compareClosing, action: fill(text, c), question: `${c.compare}？` };
    }
    return {
      lens,
      reading: [fillIn(o.light!), nextEntry.lightReading ?? fill(nextEntry.reading, slots)] as [string, string],
      closing: fill(T.lightClosing, { lightAim: nextEntry.lightAim! }),
      action: nextEntry.lightAct!,
      question: nextEntry.lightQuestion ?? fill(T.lightQuestion, { noun: T.lightNoun[request.topic] }),
    };
  }
  return {
    lens,
    reading: [fill(T.reading[intent], slots), fill(nextEntry.reading, slots)] as [string, string],
    closing: fill(T.closing[intent], slots),
    action: fill(nextEntry.frame[intent], slots) + nextEntry.stop[intent],
    question: fill(T.question[intent], slots),
  };
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
  // 先看原有主张；都不命中时才看后备主张（各层内取分高者，同分按文件里的顺序）
  return pickAmong(request, LOCAL_V2.focuses.filter((f) => !f.fallback)) ?? pickAmong(request, LOCAL_V2.focuses.filter((f) => f.fallback));
}

function pickAmong(request: ReadingRequest, focuses: Focus[]): PickedFocus | null {
  const sides = [...request.cards].sort((a, b) => a.position - b.position).map((c) => v2Side(c.cardId, c.reversed)!);
  let best: { picked: PickedFocus; score: number } | null = null;
  for (const focus of focuses) {
    // 每张牌取它在这个主张里分量最大的一个标记
    const roleTags = sides.map((side) => {
      let top: string | null = null;
      for (const tag of side.tags) if (focus.weights[tag] && (top === null || focus.weights[tag] > focus.weights[top])) top = tag;
      return top;
    });
    const contributing = roleTags.filter((t) => t !== null).length;
    const score = roleTags.reduce((sum, t) => sum + (t ? focus.weights[t] : 0), 0);
    if (focus.excludeIntents?.includes(request.intent ?? "clarify")) continue;
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
  const resolved = sides.map((side) => resolveSide(side, request.topic));
  const label = (i: number) => `${getCard(byPosition[i].cardId).nameZh}${byPosition[i].reversed ? "（逆位）" : ""}`;
  const fallbackText = (i: number) => (i === 0 ? resolved[0].situation : i === 1 ? resolved[1].obstacle.text : resolved[2].next.text);
  /** 没有贡献标记的牌：先找这个主张里按标记写的衔接，没有就用它自己的一句话要点 */
  const supportOf = (i: number) => sides[i].tags.map((t) => base.support?.[t]).find((v) => v !== undefined);

  // 主题变体覆盖默认；末牌的标记（nextVariants）再覆盖行动 / 追问，让行动跟着最后一张牌
  const variant = base.topicVariants?.[request.topic];
  const roles = { ...base.roles, ...variant?.roles };
  const claim = variant?.claim ?? base.claim;

  const cards = byPosition.map((c, i) => {
    const role = roleTags[i] ? roles[roleTags[i]!] : undefined;
    return { cardId: c.cardId, position: c.position, reversed: c.reversed, text: fillIn(role ? role.detail : (supportOf(i)?.detail ?? fallbackText(i))) };
  });
  const relation = byPosition
    .map((_, i) => {
      const role = roleTags[i] ? roles[roleTags[i]!] : undefined;
      return `${label(i)}${role ? role.relation : (supportOf(i)?.relation ?? resolved[i].oneLine)}`;
    })
    .join("；"); // 句内本来就有逗号，牌与牌之间用分号才分得清

  if (base.fallback) {
    const parts = fallbackParts(request, byPosition, base.id);
    // 陪伴：逐牌说明只给一句要点，不要求分析
    // v2.13：每张牌写自己的画面，不再共用“放着就好”的后缀
    const lightText = (i: number) =>
      parts.lens === "v2.13"
        ? (LOCAL_CONTRACT.image[sideKey(byPosition[i].cardId, byPosition[i].reversed)] ?? `${resolved[i].oneLine}。`)
        : fill(LOCAL_CONTRACT.templates.companionCard, { oneLine: resolved[i].oneLine });
    // v2.13 理清 / 决定：阻碍牌说明改写“挡在哪里”，不再沿用主张原有的建议句
    const lightCards = intent === "companion" ? cards.map((c, i) => ({ ...c, text: fillIn(lightText(i)) })) : parts.blocks ? cards.map((c, i) => (i === 1 ? { ...c, text: parts.blocks! } : c)) : cards;
    return {
      source: "local",
      // v2.13 陪伴：只留陪伴主张句和语气收尾；三张牌各自的画面在逐牌说明里
      overall: (intent === "companion" && parts.lens === "v2.13" && base.fallback && base.companionClaim
        ? [request.selfReading ? fill(LOCAL_TEMPLATE.selfReadingLead, { self: request.selfReading }) : "", `这组牌的重点是${base.companionClaim}。`, parts.closing]
        : [request.selfReading ? fill(LOCAL_TEMPLATE.selfReadingLead, { self: request.selfReading }) : "", `这组牌的重点是${claim}。`, `${relation}。`, parts.closing]
      ).join(""),
      cards: lightCards,
      interpretations: parts.reading,
      action: parts.action,
      question: parts.question,
    };
  }

  // 原有五主张保留原优先级与完整输出；后备分支不再走通用字段回退。
  const primaryVariant = base.topicVariants?.[request.topic];
  const lastVariant = sides[2].tags.map((t) => base.nextVariants?.[t]).find((v) => v !== undefined);
  const actions: Record<string, string> = { ...base.actions, ...base.topicActions?.[request.topic], ...lastVariant?.actions, ...primaryVariant?.actions };
  const questions: Record<string, string> = { ...base.questions, ...lastVariant?.questions, ...primaryVariant?.questions };
  const branches = lastVariant?.branches ?? base.intentBranches?.[intent] ?? primaryVariant?.branches ?? base.branches;

  // 末牌（下一步）的标记与主张相反时：补一句转折，并按需要换掉行动
  const nextTags = sides[2].tags;
  const turn = base.turns?.find((t) => t.whenNext.some((tag) => nextTags.includes(tag)));
  const action = fillIn(turn?.actions?.[intent] ?? actions[intent]);

  return {
    source: "local",
    overall: [request.selfReading ? fill(LOCAL_TEMPLATE.selfReadingLead, { self: request.selfReading }) : "", `这组牌的重点是${claim}。`, `${relation}。`, turn ? turn.overall : (primaryVariant?.stance?.[intent] ?? base.stance[intent])].join(""),
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
  // 主题变体：此刻 / 阻碍位 / 下一步里该主题单独写过的部分覆盖默认
  const [first, middle, last] = byPosition.map((c) => resolveSide(v2Side(c.cardId, c.reversed)!, topic));
  const obstacle = middle.obstacle;
  const next = last.next;

  const cards = byPosition.map((c, i) => {
    const text = i === 0 ? first.situation : i === 1 ? obstacle.text : next.text;
    return { cardId: c.cardId, position: c.position, reversed: c.reversed, text: fillIn(text) };
  });

  // 两拍：先核对阻碍牌的点，再交代末牌给的方向——行动和追问都落在这一步上
  const closing = fill(LOCAL_V2.closing[intent], { aim: fillIn(next.aim) });
  const labelOf = (i: number) => `${getCard(byPosition[i].cardId).nameZh}${byPosition[i].reversed ? "（逆位）" : ""}`;
  const sidesInOrder = [first, middle, last];
  // 整体用每张牌的“一句话要点”综合三张牌（不抄逐牌说明，也不是没有内容的指引）
  const synthesis = sidesInOrder.map((side, i) => `${labelOf(i)}${side.oneLine}`).join("；");
  const overall = [
    request.selfReading ? fill(LOCAL_TEMPLATE.selfReadingLead, { self: request.selfReading }) : "",
    `这组牌值得先核对的是：${obstacle.focus}。`,
    `${synthesis}。`,
    closing,
  ].join("");

  return {
    source: "local",
    overall,
    cards,
    interpretations: [fillIn(obstacle.check), fillIn(next.check)],
    // 行动由末牌的动作决定；整体收尾已经交代了这一步的方向
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
