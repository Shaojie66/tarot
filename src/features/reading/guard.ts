// 模型输出的文案检查：断言式用语、替用户下结论的典型说法。命中则判为不合格输出。

import { ASSERTIVE_PHRASES, BANNED_PHRASES } from "@/features/cards/schema";

// "不一定""不肯定会"是否定用法，不算断言
const BANNED = BANNED_PHRASES.map((p) => new RegExp(p === "一定" || p === "肯定会" ? `(?<!不)${p}` : p));

export function findForbiddenPhrase(texts: string[]): string | null {
  for (const text of texts) {
    for (const re of BANNED) if (re.test(text)) return re.source;
    for (const p of ASSERTIVE_PHRASES) if (text.includes(p)) return p;
  }
  return null;
}
