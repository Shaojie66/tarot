// v2.13 人工审读单位：阻碍位的一句行动 × 用到它的末牌（及各自的读法二）。
// 方式选择与主题无关，只有写了主题变体的阻碍位按主题分组。fingerprint 覆盖句子与成员，任何一处改动都会让该组的人工审读失效。
import { createHash } from "node:crypto";
import { LOCAL_CONTRACT, type Mode } from "@/features/reading/local";

export type ReviewGroup = { intent: "clarify" | "decide"; obstacle: string; topic: string | null; mode: Mode | "skip" | "gather"; text: string | null; members: { next: string; reading: string | null }[]; fingerprint: string };

export function buildReviewGroups(): Record<string, ReviewGroup> {
  const out: Record<string, ReviewGroup> = {};
  for (const [ok, o0] of Object.entries(LOCAL_CONTRACT.obstacle)) {
    if (!o0.modes) continue;
    const variants: [string | null, typeof o0][] = [[null, o0], ...Object.entries(o0.byTopic ?? {}).map(([t, v]) => [t, v] as [string, typeof o0])];
    for (const [topic, o] of variants) for (const intent of ["clarify", "decide"] as const) {
      const table = intent === "clarify" ? o.modes : o.compareModes;
      for (const [nk, n] of Object.entries(LOCAL_CONTRACT.next)) {
        if (!n.modes || ok.split("/")[0] === nk.split("/")[0]) continue;
        const m = n.modes.find((x) => table?.[x] !== undefined);
        const mode: ReviewGroup["mode"] = m ?? (intent === "clarify" ? "skip" : "gather");
        const key = `${intent}|${ok}${topic ? `@${topic}` : ""}|${mode}`;
        const text = m ? table![m]! : intent === "decide" ? o.gather ?? null : null;
        const g = (out[key] ??= { intent, obstacle: ok, topic, mode, text, members: [], fingerprint: "" });
        g.members.push({ next: nk, reading: m ? n.readings![m]! : intent === "decide" ? `${n.gatherLead ?? ""}（读法二：${LOCAL_CONTRACT.templates.gatherReading.replace("{lightAim}", n.lightAim ?? "")}）` : "（退回 v2.12）" });
      }
    }
  }
  for (const g of Object.values(out)) g.fingerprint = createHash("sha256").update(JSON.stringify([g.text, g.members])).digest("hex").slice(0, 12);
  return out;
}
