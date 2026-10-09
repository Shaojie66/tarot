import { z } from "zod";
import threeCard from "../../../content/spreads/three-card.json";

const spreadSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  allowReversed: z.boolean(),
  positions: z
    .array(z.strictObject({ key: z.string(), label: z.string(), hint: z.string() }))
    .min(1),
});

export type Spread = z.infer<typeof spreadSchema>;

const SPREADS = { "three-card": spreadSchema.parse(threeCard) } as const;

export type SpreadId = keyof typeof SPREADS;
export const SPREAD_IDS = Object.keys(SPREADS) as [SpreadId, ...SpreadId[]];
export const DEFAULT_SPREAD: SpreadId = "three-card";

export function getSpread(id: SpreadId): Spread {
  return SPREADS[id];
}
