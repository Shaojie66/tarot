// 首访建档（localStorage）。沿袭 settings.ts 的纯函数 + useSyncExternalStore 范式。
// 目的：把"占卜时逐步收集用户信息"改为"首访一次性收集、存本地、永不二问"。
// 红线：不收姓名 / 生日 / 星座 / 登录；建档缺失不阻塞占卜（走中性默认语气）。

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { TOPICS, type Topic } from "@/features/cards/schema";

import { INTENTS, INTENT_LABELS, type Intent } from "./intent";

export { INTENTS, INTENT_LABELS };
export type { Intent };

/** 未来回读默认节奏（可跳过）。 */
export const RECALL_CADENCES = ["none", "3days", "7days"] as const;
export type RecallCadence = (typeof RECALL_CADENCES)[number];

export const RECALL_CADENCE_LABELS: Record<RecallCadence, string> = {
  none: "不用",
  "3days": "3 天后",
  "7days": "一周后",
};

export interface Profile {
  /** 建档完成标志；未建档时占卜走"未建档"分支，不阻塞 */
  onboarded: boolean;
  intent: Intent | null;
  /** 主题偏好（多选，用于排序入口与每日焦点） */
  topics: Topic[];
  recallCadence: RecallCadence | null;
}

export const DEFAULT_PROFILE: Profile = { onboarded: false, intent: null, topics: [], recallCadence: null };

const PROFILE_KEY = "tarot:profile:v1";

const profileSchema = z.object({
  onboarded: z.boolean().catch(DEFAULT_PROFILE.onboarded),
  intent: z.enum(INTENTS).nullable().catch(DEFAULT_PROFILE.intent),
  topics: z.array(z.enum(TOPICS)).catch(DEFAULT_PROFILE.topics),
  recallCadence: z.enum(RECALL_CADENCES).nullable().catch(DEFAULT_PROFILE.recallCadence),
});

export function parseProfile(raw: string | null): Profile {
  if (!raw) return DEFAULT_PROFILE;
  try {
    return profileSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function loadProfile(): Profile {
  try {
    return parseProfile(localStorage.getItem(PROFILE_KEY));
  } catch {
    return DEFAULT_PROFILE;
  }
}

/** 写入失败（隐私模式 / 配额）返回 false；本次页面内仍然生效。 */
export function saveProfile(next: Profile): boolean {
  memory = next;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  } catch {
    emit();
    return false;
  }
  emit();
  return true;
}

/** 完成建档（未选意图也算建档完成——"此刻"无题分支可继续）。 */
export function completeOnboarding(partial: Partial<Profile> = {}): boolean {
  const cur = loadProfile();
  return saveProfile({ ...cur, ...partial, onboarded: true });
}

/** 跳过建档：标记已处理，避免每次进来都问；意图用中性默认。 */
export function skipOnboarding(): boolean {
  const cur = loadProfile();
  return saveProfile({ ...cur, onboarded: true });
}

// useSyncExternalStore 要求快照引用稳定：按原始字符串缓存，写入失败时用内存值。
let memory: Profile | null = null;
let cacheRaw: string | null | undefined;
let cacheValue: Profile = DEFAULT_PROFILE;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function snapshot(): Profile {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PROFILE_KEY);
  } catch {}
  if (raw === null && memory) return memory;
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheValue = parseProfile(raw);
    if (memory && stable(memory) === stable(cacheValue)) cacheValue = memory;
  }
  return cacheValue;
}

const stable = (p: Profile) => `${p.onboarded}|${p.intent}|${p.topics.slice().sort().join(",")}|${p.recallCadence}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useProfile(): Profile {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PROFILE);
}
