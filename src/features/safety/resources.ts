import { z } from "zod";
import data from "../../../content/safety/resources.json";

const source = z.strictObject({ name: z.string().min(2), url: z.url().refine((u) => u.startsWith("https://"), "https only") });

const resourcesSchema = z.strictObject({
  maintenance: z.string(),
  regions: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z-]+$/),
        label: z.string(),
        /** 该地区号码最近一次对照官方来源核实的日期 */
        checkedAt: z.iso.date(),
        items: z
          .array(
            z.strictObject({
              name: z.string(),
              contact: z.string().regex(/^[0-9 ]{3,12}$/),
              note: z.string(),
              /** 每条号码都要有官方来源 */
              source,
            }),
          )
          .min(1),
      }),
    )
    .min(1)
    .refine((rs) => new Set(rs.map((r) => r.id)).size === rs.length, "duplicate region id"),
  directory: z.strictObject({ name: z.string(), url: z.url() }),
  advice: z.array(z.string()).min(1),
});

/** 求助资源。只收经过核实、有官方来源的号码，见 content/safety/resources.json 的 maintenance 说明。 */
export const HELP_RESOURCES = resourcesSchema.parse(data);

export type HelpRegion = (typeof HELP_RESOURCES.regions)[number];

/** 最低地区覆盖：交付前这些地区必须在。 */
export const REQUIRED_REGION_IDS = ["cn", "gb-ie", "us", "ca"] as const;

/** 按设备时区猜一个默认地区；用户随时可以切换。猜不到就用第一个。 */
export function defaultRegionId(timeZone: string): string {
  const has = (id: string) => HELP_RESOURCES.regions.some((r) => r.id === id);
  const pick = (id: string) => (has(id) ? id : HELP_RESOURCES.regions[0].id);
  if (/^Asia\/(Shanghai|Chongqing|Harbin|Urumqi|Kashgar)$/.test(timeZone)) return pick("cn");
  if (/^(Europe\/(London|Belfast|Dublin|Jersey|Guernsey|Isle_of_Man))$/.test(timeZone)) return pick("gb-ie");
  if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Regina|Halifax|St_Johns|Montreal|Moncton|Whitehorse|Iqaluit|Yellowknife)$/.test(timeZone)) return pick("ca");
  if (/^(America\/|US\/|Pacific\/Honolulu)/.test(timeZone)) return pick("us");
  return HELP_RESOURCES.regions[0].id;
}
