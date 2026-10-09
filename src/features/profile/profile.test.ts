import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeOnboarding, DEFAULT_PROFILE, loadProfile, parseProfile, saveProfile, skipOnboarding } from "./profile";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

describe("profile", () => {
  beforeEach(() => {
    store.clear();
  });

  it("默认未建档，字段全为默认值", () => {
    expect(loadProfile()).toEqual(DEFAULT_PROFILE);
  });

  it("parseProfile 拒绝损坏输入，回退到默认", () => {
    expect(parseProfile("{not json")).toEqual(DEFAULT_PROFILE);
    expect(parseProfile('{"onboarded":"x"}')).toEqual(DEFAULT_PROFILE);
  });

  it("完成建档后 onboarded 为 true，且意图被保存", () => {
    const ok = completeOnboarding({ intent: "decide", topics: ["career", "self"], recallCadence: "3days" });
    expect(ok).toBe(true);
    const p = loadProfile();
    expect(p.onboarded).toBe(true);
    expect(p.intent).toBe("decide");
    expect(p.topics).toEqual(["career", "self"]);
    expect(p.recallCadence).toBe("3days");
  });

  it("跳过建档后不再询问，但意图保持中性默认", () => {
    skipOnboarding();
    const p = loadProfile();
    expect(p.onboarded).toBe(true);
    expect(p.intent).toBeNull();
    expect(p.recallCadence).toBeNull();
  });

  it("saveProfile 写入失败（如配额）时本次页面内仍生效，返回 false", () => {
    const ok = saveProfile({ ...DEFAULT_PROFILE, intent: "companion" });
    expect(ok).toBe(true);
    expect(loadProfile().intent).toBe("companion");
  });
});
