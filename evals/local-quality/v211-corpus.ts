import { createHash } from "node:crypto";
import { TOPICS } from "@/features/cards/schema";
import { INTENTS } from "@/features/profile/intent";
import { readingRequestSchema, type ReadingRequest, type ReadingResult } from "@/features/reading/contract";
import { LOCAL_V2, buildLocalReading, selectLocalFocus } from "@/features/reading/local";

// Frozen universe: expansion must not silently change the v2.11 regression denominator.
export const CORPUS_IDS = ["the-hermit", "the-tower", "death", "queen-of-wands", "eight-of-wands", "page-of-cups", "four-of-swords", "six-of-swords", "knight-of-swords", "two-of-pentacles", "three-of-pentacles", "page-of-pentacles"];
export const FALLBACK_IDS = ["inner-first", "rebuild", "momentum-check"];
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const signature = (r: ReadingResult) => digest([r.interpretations, r.action, r.question]);
export function requestOf(spec: string): ReadingRequest {
  const [topic, intent, list] = spec.split("|");
  return readingRequestSchema.parse({ spreadId: "three-card", topic, intent, originalQuestion: "合成问题", question: "合成问题", selfReading: "", cards: list.split(",").map((s, position) => ({ cardId: s.replace(/:r$/, ""), reversed: s.endsWith(":r"), position })) });
}
export function specOf(r: ReadingRequest) {
  return `${r.topic}|${r.intent ?? "clarify"}|${[...r.cards].sort((a, b) => a.position - b.position).map(c => c.cardId + (c.reversed ? ":r" : "")).join(",")}`;
}
export function* corpus(topic: ReadingRequest["topic"], intent: NonNullable<ReadingRequest["intent"]>) {
  for (const a of CORPUS_IDS) for (const b of CORPUS_IDS) for (const c of CORPUS_IDS) {
    if (a === b || a === c || b === c) continue;
    for (let mask = 0; mask < 8; mask++) yield requestOf(`${topic}|${intent}|${[a, b, c].map((id, i) => id + (mask & (1 << i) ? ":r" : "")).join(",")}`);
  }
}
function distribution(m: Map<string, number>) {
  const counts = [...m.values()], n = counts.reduce((a, b) => a + b, 0);
  const collisionPairs = counts.reduce((a, v) => a + v * (v - 1) / 2, 0);
  return { n, unique: m.size, redundant: n - m.size, duplicatedMembers: counts.filter(v => v > 1).reduce((a, b) => a + b, 0), collisionPairs, possiblePairs: n * (n - 1) / 2, collisionPct: n > 1 ? 100 * collisionPairs / (n * (n - 1) / 2) : 0, largestGroup: Math.max(0, ...counts) };
}
type Item = { spec: string; cardId: string; signature: string; first: string };
function sensitivity(groups: Map<string, Item[]>) {
  const counts = { replace: { pairs: 0, unchanged: 0, firstUnchanged: 0 }, flip: { pairs: 0, unchanged: 0, firstUnchanged: 0 } };
  const failures: string[][] = [];
  for (const values of groups.values()) for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
    const a = values[i], b = values[j], count = counts[a.cardId === b.cardId ? "flip" : "replace"];
    count.pairs++;
    if (a.first === b.first) count.firstUnchanged++;
    if (a.signature === b.signature) { count.unchanged++; if (failures.length < 8) failures.push([a.spec, b.spec]); }
  }
  return { ...counts, failures };
}
export function measureCorpus(visit?: (request: ReadingRequest, result: ReadingResult, focus: string | null) => void) {
  const strata = [];
  for (const topic of TOPICS) for (const intent of INTENTS) {
    const routeHash = createHash("sha256"), nonFallbackHash = createHash("sha256"), fullHash = createHash("sha256");
    const routes: Record<string, number> = {}, all = new Map<string, number>(), fallback = new Map<string, number>();
    const obstacleGroups = new Map<string, Item[]>(), nextGroups = new Map<string, Item[]>();
    for (const request of corpus(topic, intent)) {
      const spec = specOf(request), focus = selectLocalFocus(request), result = buildLocalReading(request), sig = signature(result);
      visit?.(request, result, focus);
      routeHash.update(JSON.stringify([spec, focus]));
      fullHash.update(JSON.stringify([spec, result]));
      routes[focus ?? "miss"] = (routes[focus ?? "miss"] ?? 0) + 1;
      all.set(sig, (all.get(sig) ?? 0) + 1);
      if (!focus || !FALLBACK_IDS.includes(focus)) { nonFallbackHash.update(JSON.stringify([spec, result])); continue; }
      fallback.set(sig, (fallback.get(sig) ?? 0) + 1);
      for (const position of [1, 2]) {
        const key = JSON.stringify([focus, request.cards.filter(c => c.position !== position)]);
        const groups = position === 1 ? obstacleGroups : nextGroups;
        const values = groups.get(key) ?? [];
        values.push({ spec, cardId: request.cards[position].cardId, signature: sig, first: digest(result.interpretations[0]) });
        groups.set(key, values);
      }
    }
    strata.push({ topic, intent, routes, routingHash: routeHash.digest("hex"), nonFallbackHash: nonFallbackHash.digest("hex"), fullHash: fullHash.digest("hex"), all: distribution(all), fallback: distribution(fallback), obstacle: sensitivity(obstacleGroups), next: sensitivity(nextGroups) });
  }
  return { version: LOCAL_V2.version, ids: CORPUS_IDS, signature: "[interpretations, action, question]; compare within topic and intent", strata };
}
