import { describe, expect, it } from "vitest";
import { HELP_RESOURCES, REQUIRED_REGION_IDS, defaultRegionId } from "./resources";

describe("求助资源：最低地区覆盖，每条有官方来源与复核日期", () => {
  it("最低覆盖的地区都在（大陆、英国 / 爱尔兰、美国、加拿大）", () => {
    const ids = HELP_RESOURCES.regions.map((r) => r.id);
    for (const id of REQUIRED_REGION_IDS) expect(ids).toContain(id);
  });

  it("每个地区有复核日期、每条号码有 https 官方来源", () => {
    for (const region of HELP_RESOURCES.regions) {
      expect(region.checkedAt, region.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(region.checkedAt)).toBeLessThanOrEqual(Date.now() + 86_400_000);
      for (const item of region.items) {
        expect(item.source.url, `${region.id}/${item.contact}`).toMatch(/^https:\/\//);
        expect(item.note.length).toBeGreaterThan(0);
      }
    }
  });

  it("不含未核实的占位或臆测号码：同一地区内号码不重复，号码只含数字与空格", () => {
    for (const region of HELP_RESOURCES.regions) {
      const contacts = region.items.map((i) => i.contact);
      expect(new Set(contacts).size).toBe(contacts.length);
      for (const c of contacts) expect(c).toMatch(/^[0-9 ]+$/);
    }
  });

  it("按时区猜默认地区；猜不到回到第一个", () => {
    expect(defaultRegionId("Asia/Shanghai")).toBe("cn");
    expect(defaultRegionId("Europe/London")).toBe("gb-ie");
    expect(defaultRegionId("Europe/Dublin")).toBe("gb-ie");
    expect(defaultRegionId("America/New_York")).toBe("us");
    expect(defaultRegionId("America/Los_Angeles")).toBe("us");
    expect(defaultRegionId("America/Toronto")).toBe("ca");
    expect(defaultRegionId("America/Vancouver")).toBe("ca");
    expect(defaultRegionId("Antarctica/Troll")).toBe(HELP_RESOURCES.regions[0].id);
    expect(defaultRegionId("")).toBe(HELP_RESOURCES.regions[0].id);
  });
});
