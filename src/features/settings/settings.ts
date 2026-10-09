// 本机设置（localStorage）。只放“下一次怎么抽 / 用哪套牌”这类偏好，不含 key，不随备份覆盖。
// 历史记录按保存当时的快照渲染，改设置不会追改旧记录（见 docs/PLAN.md M3 行为约定 4）。

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { DECKS, DEFAULT_DECK, type DeckId } from "@/features/cards/deck";

export interface Settings {
  /** 抽牌时是否可能出现逆位。只影响下一次抽牌。 */
  allowReversed: boolean;
  deckId: DeckId;
}

export const DEFAULT_SETTINGS: Settings = { allowReversed: true, deckId: DEFAULT_DECK };

const SETTINGS_KEY = "tarot:settings:v1";

const settingsSchema = z.object({
  allowReversed: z.boolean().catch(DEFAULT_SETTINGS.allowReversed),
  // 未知牌组（比如以后删掉了某套）回到默认，而不是让页面报错
  deckId: z.string().catch(DEFAULT_SETTINGS.deckId),
});

export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = settingsSchema.parse(JSON.parse(raw));
    return {
      allowReversed: parsed.allowReversed,
      deckId: parsed.deckId in DECKS ? (parsed.deckId as DeckId) : DEFAULT_DECK,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** 写入失败（隐私模式 / 配额）返回 false；设置在本次页面内仍然生效。 */
export function saveSettings(next: Settings): boolean {
  memory = next;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    emit();
    return false;
  }
  emit();
  return true;
}

// useSyncExternalStore 要求快照引用稳定：按原始字符串缓存，写入失败时用内存值。
let memory: Settings | null = null;
let cacheRaw: string | null | undefined;
let cacheValue: Settings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function snapshot(): Settings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
  } catch {}
  if (raw === null && memory) return memory;
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheValue = parseSettings(raw);
    if (memory && stable(memory) === stable(cacheValue)) cacheValue = memory;
  }
  return cacheValue;
}
const stable = (s: Settings) => `${s.allowReversed}|${s.deckId}`;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_SETTINGS);
}
