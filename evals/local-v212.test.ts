import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LOCAL_CONTRACT, LOCAL_V2, buildLocalReading, selectFallbackLens, selectFallbackMode, selectLocalFocus, type Mode } from "@/features/reading/local";
import { readingResultSchema, resultMatchesDraw } from "@/features/reading/contract";
import { findForbiddenPhrase } from "@/features/reading/guard";
import { TOPICS } from "@/features/cards/schema";
import { INTENTS } from "@/features/profile/intent";
import baseline from "./local-quality/baseline-v2.10.json";
import { CORPUS_IDS, FALLBACK_IDS, corpus, measureCorpus, specOf } from "./local-quality/v211-corpus";
import modeTable from "./local-quality/v213-mode-table.json";
import { buildReviewGroups } from "./local-quality/v213-review-groups";

const REVIEW_TABLE = modeTable.groups as Record<string, { fingerprint: string; reviewed: string | null; aiReviewed?: string | null }>;
const GROUPS = buildReviewGroups();
// 每个（意图, 阻碍位[@主题], 末牌）落在哪一组
const GROUP_OF = new Map<string, string>();
for (const [k, g] of Object.entries(GROUPS)) for (const m of g.members) GROUP_OF.set(`${g.intent}|${g.obstacle}${g.topic ? `@${g.topic}` : ""}|${m.next}`, k);

// v2.12：后备路径由核对契约构造。批次未写完时（契约覆盖 < 24 / 24）只检查已覆盖的组合；写全后再加全量指标。
const SIDES = CORPUS_IDS.flatMap((id) => [`${id}/upright`, `${id}/reversed`]);
const complete = SIDES.every((k) => k in LOCAL_CONTRACT.obstacle && k in LOCAL_CONTRACT.next);
const key = (c: { cardId: string; reversed: boolean }) => `${c.cardId}/${c.reversed ? "reversed" : "upright"}`;
const covered = (cards: { cardId: string; reversed: boolean }[]) => key(cards[1]) in LOCAL_CONTRACT.obstacle && key(cards[2]) in LOCAL_CONTRACT.next;
const wherePlaceholder = /\{[a-zA-Z]+\}|undefined/;

describe("v2.12：核对契约", () => {
  it("契约只含 12 张语料牌的朝向；写全时 24 + 24 条齐全", () => {
    for (const k of [...Object.keys(LOCAL_CONTRACT.obstacle), ...Object.keys(LOCAL_CONTRACT.next)]) expect(SIDES, k).toContain(k);
    if (complete) expect(Object.keys(LOCAL_CONTRACT.obstacle)).toHaveLength(24);
    // 记录进度，便于分批时对照
    console.log(`contract coverage: obstacle ${Object.keys(LOCAL_CONTRACT.obstacle).length}/24, next ${Object.keys(LOCAL_CONTRACT.next).length}/24`);
  });

  it("末牌的槽不命名要核对的对象：frame / stop / aim / reading 里不含任何阻碍位的 object 或 standard", () => {
    const objects = Object.values(LOCAL_CONTRACT.obstacle).flatMap((o) => [o, ...Object.values(o.byTopic ?? {})]).flatMap((o) => [o.object, o.standard]).map((t) => t.replaceAll("{in}", ""));
    for (const [side, n] of Object.entries(LOCAL_CONTRACT.next)) {
      const texts = [n.aim, n.reading.replaceAll("{object}", ""), ...Object.values(n.frame), ...Object.values(n.stop),  n.lightAct ?? "", n.lightAim ?? "", n.lightReading ?? ""];
      for (const text of texts) for (const o of objects) expect(text.replaceAll("{probe}", ""), `${side} 含 ${o}`).not.toContain(o);
    }
  });

  it("陪伴用的槽不含要求认知产出的动词，也不要求写 / 列 / 记", () => {
    const heavy = /判断|选择|决定|分清|列出|计划|写下|记下|记一句|写一句|只写|清单|核对|两栏/;
    for (const [side, o] of Object.entries(LOCAL_CONTRACT.obstacle)) for (const slot of [o, ...Object.values(o.byTopic ?? {})]) for (const text of [slot.object, slot.standard, slot.probeLight]) expect(text, `${side}`).not.toMatch(heavy);
    for (const [side, n] of Object.entries(LOCAL_CONTRACT.next)) for (const text of [n.aim, n.frame.companion, n.stop.companion]) expect(text, side).not.toMatch(heavy);
    for (const [side, n] of Object.entries(LOCAL_CONTRACT.next)) expect(n.stop.companion, side).toMatch(/不想做也可以|不用|不必|放着/);
    // v2.13 陪伴槽：不出判断题
    const judge = /是否|有没有|够不够|还是/;
    for (const [side, o] of Object.entries(LOCAL_CONTRACT.obstacle)) if (o.light) expect(o.light, side).not.toMatch(new RegExp(`${heavy.source}|${judge.source}`));
    for (const [side, n] of Object.entries(LOCAL_CONTRACT.next)) for (const text of [n.lightAct, n.lightAim, n.lightReading]) if (text) expect(text, side).not.toMatch(new RegExp(`${heavy.source}|${judge.source}`));
    for (const [side, text] of Object.entries(LOCAL_CONTRACT.image)) expect(text, side).not.toMatch(new RegExp(`${heavy.source}|${judge.source}`));
  });

  it("v2.13：收集句不与按方式写的句子近似重复；写下来统一；读法二不指代阻碍位；审读表与当前内容一致", () => {
    const bigrams = (t: string) => new Set([...t.replace(/[，。：、{}a-z]/g, "")].map((ch, i, arr) => ch + (arr[i + 1] ?? "")).slice(0, -1));
    const jaccard = (a: string, b: string) => { const x = bigrams(a), y = bigrams(b); return [...x].filter((g) => y.has(g)).length / new Set([...x, ...y]).size; };
    const slots = Object.entries(LOCAL_CONTRACT.obstacle).flatMap(([side, o0]) => [o0, ...Object.values(o0.byTopic ?? {})].map((o) => [side, o] as const));
    for (const [side, o] of slots) {
      if (o.gather) for (const [m, text] of Object.entries(o.compareModes ?? {})) expect(jaccard(o.gather, text!), `${side} gather ≈ compareModes.${m}`).toBeLessThan(0.5);
      // 写下来：统一写“写”，并给不想写的人一个出口
      for (const text of [o.modes?.say, o.compareModes?.say]) if (text) expect(text, `${side} say`).toMatch(/写[\s\S]*不想写/);
    }
    // 读法二只讲末牌和方式：不出现任何阻碍位对象的中心词（对象去掉 {in} 后的最后两个字），也不布置分类、清单之类的任务
    // 同一张牌不会同时在阻碍位和下一步，所以不比对本牌自己的对象
    const centers = slots.map(([side, o]) => [side.split("/")[0], o.object.replaceAll("{in}", "").slice(-2)] as const).filter(([, c]) => !/^(件事|的事|这事|一步|的点|小事|时间|方式)$/.test(c));
    for (const [side, n] of Object.entries(LOCAL_CONTRACT.next)) for (const [m, text] of Object.entries(n.readings ?? {})) {
      for (const [card, c] of centers) if (card !== side.split("/")[0]) expect(text!, `${side} readings.${m} 含阻碍位对象「${c}」`).not.toContain(c);
      expect(text!, `${side} readings.${m}`).not.toMatch(/分成|两堆|列出|清单|核对/);
      // 写下来的读法二只讲方式，不指定写什么（写什么由阻碍位的句子给）
      if (m === "say") { expect(text!, `${side} readings.say`).toContain("写"); expect(text!, `${side} readings.say 指定了写什么`).not.toContain("把"); }
    }
    // 审读表：每组都在、指纹与当前内容一致（不一致说明内容改了而表没更新：跑 V213_GROUPS=1 的生成器）
    expect(Object.keys(REVIEW_TABLE).sort()).toEqual(Object.keys(GROUPS).sort());
    for (const [k, g] of Object.entries(GROUPS)) expect(REVIEW_TABLE[k].fingerprint, `${k} 审读表过期`).toBe(g.fingerprint);
    // reviewed 只由用户填写；aiReviewed 是用户决定的 AI 代审（不计作人工）。两者都没有的组为待审
    const human = Object.values(REVIEW_TABLE).filter((row) => row.reviewed !== null).length;
    const pending = Object.values(REVIEW_TABLE).filter((row) => row.reviewed === null && !row.aiReviewed).length;
    console.log(`review groups: ${Object.keys(GROUPS).length}, 人工已审 ${human}, 仅 AI 代审 ${Object.keys(GROUPS).length - human - pending}, 待审 ${pending}`);
  });

  it("v2.13 护栏：同一组此刻 / 阻碍牌下只换末牌，行动逐字相同的比例 ≤ 10%（理清、决定分别算）", () => {
    for (const intent of ["clarify", "decide"] as const) {
      const groups = new Map<string, string[]>();
      for (const topic of TOPICS) for (const req of corpus(topic, intent)) {
        if (selectFallbackLens(req) !== "v2.13") continue;
        const k = specOf(req).split(",").slice(0, 2).join(",");
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(buildLocalReading(req).action);
      }
      let same = 0, total = 0;
      for (const list of groups.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { total++; if (list[i] === list[j]) same++; }
      console.log(`${intent}: end-card swap identical action ${(100 * same / total).toFixed(1)}%`);
      expect(same / total, `${intent} 换末牌后行动逐字相同的比例`).toBeLessThanOrEqual(0.1);
    }
  }, 180000);

  it("probe 不带时间或分量（由末牌的 frame 给），frame 不重复给具体时长", () => {
    for (const [side, n] of Object.entries(LOCAL_CONTRACT.next)) for (const text of Object.values(n.frame)) expect(text.replace("试一周", ""), side).not.toMatch(/\d+\s*分钟|[二三四五六七八九十]十?分钟|小时/);
  });

  it("内容格式拒绝后备主张的废弃字段；正文与自解不参与后续文本", () => {
    for (const f of LOCAL_V2.focuses.filter((f) => f.fallback)) {
      for (const field of ["actions", "questions", "branches", "stance", "intentBranches", "turns", "topicActions", "nextVariants", "obstacleVariants"]) expect(field in f, `${f.id}/${field}`).toBe(false);
    }
    expect("fallbackClosing" in LOCAL_V2).toBe(false);
  });

  it("全量枚举：路由与非后备输出与 v2.10 基线一致；已覆盖的后备输出满足不变量", () => {
    const errors: string[] = [];
    const check = (ok: boolean, message: string) => { if (!ok && errors.length < 20) errors.push(message); };
    let rendered = 0, v213 = 0;
    for (const topic of TOPICS) for (const intent of INTENTS) {
      const routeHash = createHash("sha256"), nonFallbackHash = createHash("sha256");
      const routes: Record<string, number> = {};
      for (const req of corpus(topic, intent)) {
        const spec = specOf(req), focusId = selectLocalFocus(req);
        routeHash.update(JSON.stringify([spec, focusId]));
        routes[focusId ?? "miss"] = (routes[focusId ?? "miss"] ?? 0) + 1;
        const isFallback = focusId !== null && FALLBACK_IDS.includes(focusId);
        if (isFallback && !covered(req.cards)) continue;
        const r = buildLocalReading(req);
        if (!isFallback) { nonFallbackHash.update(JSON.stringify([spec, r])); continue; }
        rendered++;
        const sorted = [...req.cards].sort((a, b) => a.position - b.position);
        const text = [r.overall, ...r.cards.map((c) => c.text), ...r.interpretations, r.action, r.question].join("\n");
        check(JSON.stringify(buildLocalReading(req)) === JSON.stringify(r), `${spec}: nondeterministic`);
        check(readingResultSchema.safeParse(r).success && resultMatchesDraw(r, req), `${spec}: invalid result`);
        check(!findForbiddenPhrase([text]) && !wherePlaceholder.test(text), `${spec}: redline/placeholder`);
        check(r.interpretations[0] !== r.interpretations[1], `${spec}: identical readings`);
        const o = LOCAL_CONTRACT.obstacle[key(sorted[1])], slot = o.byTopic?.[req.topic] ?? o;
        const where = LOCAL_V2.locative[req.topic], fillIn = (t: string) => t.replaceAll("{in}", where);
        if (selectFallbackLens(req) === "v2.13") {
          v213++;
          // v2.13：这组牌落在审读表的哪一组；行动就是该组的句子，读法二就是该组里这张末牌的读法二
          const n = LOCAL_CONTRACT.next[key(sorted[2])];
          const variant = o.byTopic?.[req.topic] ? `@${req.topic}` : "";
          if (req.intent === "clarify" || req.intent === "decide") {
            const gk = GROUP_OF.get(`${req.intent}|${key(sorted[1])}${variant}|${key(sorted[2])}`);
            const g = gk ? GROUPS[gk] : undefined;
            check(g !== undefined && g.mode !== "skip", `${spec}: 不在审读表的任何一组`);
            if (g && g.mode !== "skip") {
              const member = g.members.find((m) => m.next === key(sorted[2]))!;
              const expectedAction = g.mode === "gather" ? (n.gatherLead ?? "") + g.text! : g.text!;
              check(r.action === fillIn(expectedAction.replaceAll("{compare}", slot.compare ?? "")) && (g.mode === "gather" || r.interpretations[1] === member.reading), `${spec}: 行动 / 读法二与审读组 ${gk} 不一致`);
            }
            // 桥接：整体末尾由“命中的主张 × 阻碍位”的桥接句把重点落到对象上；对象在整体里只出现一次
            const focusId = selectLocalFocus(req)!;
            const bridge = LOCAL_CONTRACT.templates.bridge[focusId as keyof typeof LOCAL_CONTRACT.templates.bridge];
            check(bridge !== undefined, `${spec}: 缺桥接句 ${focusId}`);
            const lead = fillIn(slot.objectIf ?? "");
            check(lead !== "", `${spec}: 缺条件式引子 objectIf`);
            const bridged = bridge ? bridge.replaceAll("{objectIf}", lead) : "";
            // 整体不把处境写成已知：对象原文不出现，条件式引子恰好出现一次
            check(!r.overall.includes(fillIn(slot.object)) && r.overall.split(lead).length === 2, `${spec}: 整体应只含一次条件式引子`);
            check(r.cards[1].text === fillIn(slot.blocks ?? ""), `${spec}: 阻碍说明应为“挡在哪里”`);
            if (req.intent === "clarify") {
              check(r.overall.endsWith(bridged) && r.interpretations[0] === `先核对：${fillIn(slot.standard)}。`, `${spec}: v2.13 clarify bridge`);
              check(r.question.includes(fillIn(slot.standard)), `${spec}: clarify question standard`);
            } else {
              check(r.overall.endsWith(bridged) && !r.overall.includes(LOCAL_CONTRACT.templates.compareClosing), `${spec}: v2.13 decide bridge`);
              check(r.question === `${fillIn(slot.compare!)}？` && !r.interpretations[0].includes(fillIn(slot.compare!)), `${spec}: v2.13 decide compare`);
            }
          }
          if (req.intent === "companion") {
            const light = [r.overall.slice(r.overall.lastIndexOf("。", r.overall.length - 2) + 1), ...r.interpretations, r.action, r.question, ...r.cards.map((c) => c.text)].join("");
            check(!light.includes(fillIn(slot.standard)) && !light.includes(fillIn(slot.object)), `${spec}: companion renders standard/object`);
            check(!Object.values(LOCAL_CONTRACT.templates.bridge).some((b) => r.overall.includes(b.split("{objectIf}")[0])), `${spec}: 陪伴不应出现桥接句`);
            check(!/是否|有没有|够不够|还是|判断|选择|决定|分清|列出|计划|写下|记下|核对|清单/.test(light.replaceAll(where, "").replaceAll(where.replace(/里$/, ""), "")), `${spec}: companion load`);
            check((light.match(/不想|不做|不说|不这样/g) ?? []).length === 1, `${spec}: companion opt-out count`);
            check(new Set(r.cards.map((c) => c.text)).size === 3 && !r.cards.some((c) => c.text.includes("放着就好")), `${spec}: companion card text`);
          }
          if (req.topic === "relationship") check(!/联系|发消息|一起|对方回复|告诉对方|约对方/.test(r.action), `${spec}: relational action`);
          continue;
        }
        // v2.12：行动里的观察动作来自阻碍位，追问里的标准来自阻碍位
        check(r.action.includes(fillIn(req.intent === "companion" ? slot.probeLight : slot.probe)), `${spec}: action lost obstacle probe`);
        check(r.question.includes(fillIn(slot.standard)), `${spec}: question lost obstacle standard`);
        check(r.interpretations[0].includes(fillIn(slot.object)) && r.overall.includes(fillIn(slot.object)), `${spec}: object missing in reading/overall`);
        if (req.intent === "companion") {
          check(r.overall.includes("不想做也可以"), `${spec}: missing opt-out`);
          // 只查契约产出的部分；重点句与逐牌关系沿用主张里的原文，其中的分析动词是另一个已知边界（见 v212-plan）
          const closing = r.overall.slice(r.overall.indexOf("如果愿意，这次只留意"));
          check(closing.startsWith("如果愿意，这次只留意"), `${spec}: companion closing`);
          check(!/判断|选择|决定|分清|列出|计划|写下|记下|核对|清单/.test([r.action, r.question, closing, ...r.interpretations].join("").replaceAll(where, "")), `${spec}: companion load verb`);
          check(r.cards.every((c) => c.text.endsWith("放着就好。")), `${spec}: companion card text`);
        }
        if (req.topic === "relationship") check(!/联系|发消息|一起|对方回复|告诉对方|约对方/.test(r.action.replaceAll("不必联系对方", "")), `${spec}: relational action`);
        if (req.topic === "self" || req.topic === "relationship") check(!/分工|别人配合|同事|老板|需要谁/.test([r.interpretations.join(""), r.action, r.question].join("")), `${spec}: other-person context`);
      }
      const old = baseline.strata.find((b) => b.topic === topic && b.intent === intent)!;
      expect(routeHash.digest("hex"), `${topic}/${intent} routing`).toBe(old.routingHash);
      expect(routes, `${topic}/${intent} routes`).toEqual(old.routes);
      expect(nonFallbackHash.digest("hex"), `${topic}/${intent} non-fallback`).toBe(old.nonFallbackHash);
    }
    expect(errors).toEqual([]);
    expect(rendered).toBeGreaterThan(0);
    expect(v213, "v2.13 小样应有组合走新写法").toBeGreaterThan(0);
    console.log(`fallback rendered ${rendered}, v2.13 ${v213}`);
  }, 120000);

  it.skipIf(!complete)("写全后：行动随阻碍位变化 100%，阻碍位 / 末位换牌与翻面都改变后续文本，后备撞词率 ≤ 2%", () => {
    const actionGroups = new Map<string, { cardId: string; action: string; spec: string }[]>();
    const measured = measureCorpus((req, r, focusId) => {
      if (!focusId || !FALLBACK_IDS.includes(focusId)) return;
      const gk = JSON.stringify([focusId, req.topic, req.intent, req.cards.filter((c) => c.position !== 1)]);
      const list = actionGroups.get(gk) ?? [];
      // v2.13 陪伴的行动来自末牌（校准 6 例已确认），阻碍位体现在读法一：这类组合比较读法一
      const lightLens = req.intent === "companion" && selectFallbackLens(req) === "v2.13";
      list.push({ cardId: req.cards[1].cardId + (req.cards[1].reversed ? ":r" : ""), action: lightLens ? `light:${r.interpretations[0]}` : r.action, spec: specOf(req) });
      actionGroups.set(gk, list);
    });
    const failures: string[][] = [];
    let pairs = 0;
    for (const list of actionGroups.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      pairs++;
      if (list[i].action === list[j].action && failures.length < 8) failures.push([list[i].spec, list[j].spec]);
    }
    expect(pairs).toBeGreaterThan(0);
    expect(failures).toEqual([]);
    for (const s of measured.strata) {
      const label = `${s.topic}/${s.intent}`;
      for (const position of ["obstacle", "next"] as const) for (const kind of ["replace", "flip"] as const) {
        expect(s[position][kind].pairs, `${label}/${position}/${kind}`).toBeGreaterThan(0);
        expect(s[position][kind].unchanged, JSON.stringify(s[position].failures)).toBe(0);
        if (position === "obstacle") expect(s[position][kind].firstUnchanged, `${label}/${kind}: obstacle reading`).toBe(0);
      }
      expect(s.fallback.collisionPct, label).toBeLessThanOrEqual(2);
    }
    console.log(JSON.stringify(measured.strata.map((s) => ({ topic: s.topic, intent: s.intent, fallbackUnique: s.fallback.unique, fallbackCollisionPct: s.fallback.collisionPct })), null, 1));
  }, 180000);
});
