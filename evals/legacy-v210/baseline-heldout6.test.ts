// BASELINE_V210_H6=1 pnpm vitest run evals/legacy-v210/baseline-heldout6.test.ts
// Rebuilds v2.10 (commit 9148317) outputs for heldout6. First checks the rebuilt engine reproduces the 42 frozen round-2 baseline outputs.
import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import heldout from "../../docs/local-reading-expansion/batch-0-heldout.json";
import round2 from "../local-quality/baseline-v2.10-round2.json";
import { requestOf } from "../local-quality/v211-corpus";
import { buildLocalReading, selectLocalFocus } from "./local";

it.skipIf(process.env.BASELINE_V210_H6 !== "1")("rebuild v2.10 baseline for heldout6", () => {
  const out = "evals/local-quality/baseline-v2.10-heldout6.json";
  expect(existsSync(out), "Never overwrite a baseline").toBe(false);
  for (const x of round2.heldout) expect(JSON.stringify(buildLocalReading(requestOf(x.spec))), x.spec).toBe(JSON.stringify(x.output));
  const p = heldout.heldout6Protocol;
  const specs = [...heldout.heldout6, ...p.swaps.map(([, swapped]) => swapped)];
  writeFileSync(out, JSON.stringify({ commit: "9148317", version: "local-v2.10-sample", heldout: specs.map((spec) => ({ spec, focus: selectLocalFocus(requestOf(spec)), output: buildLocalReading(requestOf(spec)) })) }, null, 2) + "\n");
});
