// FREEZE_V213_HELDOUT9=1 pnpm vitest run evals/freeze-v213-heldout9.test.ts
// Fixes the v2.13 holdout from card IDs, orientations and routing only (no rendered text is read).
// Writes heldout9 + heldout9Protocol into batch-0-heldout.json once; refuses to overwrite.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TOPICS } from "@/features/cards/schema";
import { INTENTS } from "@/features/profile/intent";
import { selectLocalFocus } from "@/features/reading/local";
import { CORPUS_IDS, FALLBACK_IDS, digest, requestOf } from "./local-quality/v211-corpus";

const HELDOUT = "docs/local-reading-expansion/batch-0-heldout.json";
const SOURCES = [
  HELDOUT,
  "evals/local-quality/cases.json",
  "evals/local-quality/reserved.json",
  "evals/local-quality/baseline-v2.1.json",
  "evals/local-quality/baseline-v2.10.json",
  "evals/local-quality/baseline-v2.10-round2.json",
  "docs/local-reading-expansion/batch-0-v211-frozen.json",
  "docs/local-reading-expansion/batch-0-v211-round2-frozen.json",
  "docs/local-reading-expansion/batch-0-v212-frozen.json",
  "docs/local-reading-expansion/batch-0-v212-blind-key.json",
  "evals/local-quality/baseline-v2.10-heldout5.json",
  "evals/print-v213-sample.test.ts",
  "docs/local-reading-expansion/batch-0-v213-final-blind-key.json",
  "evals/local-quality/baseline-v2.10-heldout6.json",
  "docs/local-reading-expansion/batch-0-v213-final2-blind-key.json",
  "evals/local-quality/baseline-v2.10-heldout7.json",
  "docs/local-reading-expansion/batch-0-v213-final3-blind-key.json",
  "evals/local-quality/baseline-v2.10-heldout8.json",
  "docs/local-reading-expansion/batch-0-v213-blind-key.json",
  "docs/local-reading-expansion/batch-0-v213-blind-r10-key.json",
  "docs/local-reading-expansion/batch-0-v213-blind-r2-key.json",
  "docs/local-reading-expansion/batch-0-v213-blind-r3-key.json",
  "docs/local-reading-expansion/batch-0-v213-blind-r4-key.json",
  "docs/local-reading-expansion/batch-0-v213-blind-r5-key.json",
  "docs/local-reading-expansion/batch-0-v213-blind-r6-key.json",
  "docs/local-reading-expansion/batch-0-v213-blind-r7-key.json",
  "docs/local-reading-expansion/batch-0-v213-blind-r8-key.json",
  "docs/local-reading-expansion/batch-0-v213-blind-r9-key.json",
];
const SEED = 2026102704;
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const idsOf = (draw: string) => draw.split(",").map((c) => c.replace(/:r$/, "")).join(",");

it.skipIf(process.env.FREEZE_V213_HELDOUT9 !== "1")("fix the v2.13 holdout", () => {
  const heldout = JSON.parse(readFileSync(HELDOUT, "utf8"));
  expect(heldout.heldout9, "Never overwrite a fixed holdout").toBeUndefined();

  // Exclude every ordered card triple seen anywhere, whatever its orientation, topic or intent.
  const cardToken = `(?:${CORPUS_IDS.join("|")})(?::r)?`;
  const found = new RegExp(`${cardToken}(?:,${cardToken}){2}`, "g");
  const excludedIds = new Set<string>();
  for (const path of SOURCES) for (const m of readFileSync(path, "utf8").matchAll(found)) excludedIds.add(idsOf(m[0]));
  const exclusions = [...excludedIds].sort();

  const orientations = (ids: string[]) => Array.from({ length: 8 }, (_, mask) => ids.map((id, i) => id + (mask & (1 << i) ? ":r" : "")));
  const eligible = (topic: string, intent: string) => {
    const out: string[] = [];
    for (const a of CORPUS_IDS) for (const b of CORPUS_IDS) for (const c of CORPUS_IDS) {
      if (a === b || a === c || b === c || excludedIds.has(`${a},${b},${c}`)) continue;
      for (const cards of orientations([a, b, c])) out.push(`${topic}|${intent}|${cards.join(",")}`);
    }
    return out.sort((x, y) => sha([SEED, x]).localeCompare(sha([SEED, y])));
  };

  // 6 per intent: slot 0 for every topic, slot 1 for career and self. Fallback focus rotates by topic/intent/slot.
  const used = new Set<string>();
  const base: string[] = [];
  const slots: [number, number][] = [];
  TOPICS.forEach((_, t) => slots.push([t, 0]));
  [0, 2].forEach((t) => slots.push([t, 1]));
  INTENTS.forEach((intent, n) => {
    for (const [t, slot] of slots) {
      const wanted = FALLBACK_IDS[(t + n + slot) % 3];
      const spec = eligible(TOPICS[t], intent).find((s) => selectLocalFocus(requestOf(s)) === wanted && !used.has(idsOf(s.split("|")[2])));
      expect(spec, `${TOPICS[t]}|${intent}|${wanted}`).toBeDefined();
      used.add(idsOf(spec!.split("|")[2]));
      base.push(spec!);
    }
  });
  expect(base).toHaveLength(18);

  // Mechanism pairs: change only the obstacle card (6) or only the last card (6), keeping the same fallback focus.
  const ordered = [...base].sort((x, y) => sha([SEED, "swap", x]).localeCompare(sha([SEED, "swap", y])));
  const swapFor = (spec: string, position: number): [string, string] | null => {
    const [topic, intent, list] = spec.split("|");
    const cards = list.split(","), focus = selectLocalFocus(requestOf(spec));
    const candidates = CORPUS_IDS.flatMap((id) => [id, `${id}:r`]).filter((token) => !cards.some((c) => c.replace(/:r$/, "") === token.replace(/:r$/, "")));
    candidates.sort((x, y) => sha([SEED, "swap-card", spec, x]).localeCompare(sha([SEED, "swap-card", spec, y])));
    for (const token of candidates) {
      const next = cards.map((c, i) => (i === position ? token : c)), swapped = `${topic}|${intent}|${next.join(",")}`;
      if (excludedIds.has(idsOf(next.join(","))) || used.has(idsOf(next.join(",")))) continue;
      if (selectLocalFocus(requestOf(swapped)) !== focus) continue;
      return [spec, swapped];
    }
    return null;
  };
  // Walk the ordered list: a base with no valid swap at the position still due is skipped, not forced.
  const swaps: [string, string][] = [];
  const swappedBases = new Set<string>();
  for (const position of [1, 2]) {
    for (const spec of ordered) {
      if (swaps.filter((_, n) => (n < 6 ? 1 : 2) === position).length >= 6) break;
      if (swappedBases.has(spec)) continue;
      const pair = swapFor(spec, position);
      if (!pair) continue;
      used.add(idsOf(pair[1].split("|")[2]));
      swappedBases.add(spec);
      swaps.push(pair);
    }
  }
  expect(swaps).toHaveLength(12);

  const inputs = [...base, ...swaps.map(([, swapped]) => swapped)];
  expect(new Set(inputs).size).toBe(inputs.length);
  heldout.heldout9 = base;
  heldout.heldout9Protocol = {
    fixedAt: "2026-10-27",
    seed: SEED,
    version: "local-v2.13-sample",
    commit: execSync("git rev-parse --short HEAD").toString().trim(),
    note: "Fixed after the v2.13 content was written (24 obstacle × 24 end-card sides) and before the final review. Inputs selected from card IDs, orientations and routing only; no rendered text was read. Excludes every card-ID triple used in calibration, the ten v2.13 mini blind rounds, v2.12 frozen material and heldout1–5, plus heldout6–8 (used for the bridge, object-presupposition and end-card-variation revisions), so no input here informed any v2.13 revision. Routing is unchanged since v2.10. Any case that informs a revision must be marked used and replaced before the next review.",
    selection: "Sort eligible inputs by SHA256(JSON.stringify([seed,spec])). Per intent, slot 0 for every topic and slot 1 for career and self (6 per intent, 18 total); fallback focus = FALLBACK_IDS[(topicIndex+intentIndex+slot)%3] under current routing; take first ordered draw whose card-ID triple is unused. Exclude any ordered card-ID triple found in the exclusion sources, whatever its orientation, topic or intent.",
    topics: TOPICS,
    intents: INTENTS,
    focuses: FALLBACK_IDS,
    exclusionSources: SOURCES,
    excludedTriples: exclusions.length,
    exclusionDigest: sha(exclusions),
    swapRule: "Order the 18 by SHA256([seed,'swap',spec]); walk that order, skipping bases with no valid swap and never reusing a base: first 6 pairs replace only the obstacle card, next 6 only the last card, with the first candidate (SHA256([seed,'swap-card',spec,token])) that keeps the same fallback focus and an unused, non-excluded card-ID triple. Each pair is [base, swapped].",
    swaps,
    blind: base,
    inputsDigest: digest(inputs),
    status: "fixed-unseen",
    usedForRevision: false,
    candidateFreeze: null,
  };
  writeFileSync(HELDOUT, JSON.stringify(heldout, null, 1) + "\n");
});
