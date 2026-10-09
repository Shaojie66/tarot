// 模型输出的容错与归因。产品支持各种模型（Anthropic、DeepSeek、OpenAI 兼容接口、本地模型），
// 它们对“只输出这个 schema”的遵守程度不一。这里只做**无损、不改变语义**的整理：
//   - 从文本里取出 JSON 对象（去掉 ``` 围栏、前后多余文字）；
//   - 丢弃 schema 之外的多余字段；把明显的类型偏差（字符串数字、套了一层的数组）拉回规定的形状。
// 不做的事：不补内容、不改写文字、不降低任何硬约束——牌面一致、禁词、crisis 为布尔值、读法个数、问句结尾，仍由业务校验逐条把关。

const ALLOWED_TOP = ["overall", "cards", "interpretations", "action", "question"] as const;
const ALLOWED_CARD = ["cardId", "position", "reversed", "text"] as const;
const ALLOWED_PERSPECTIVE = ["overall", "interpretations", "question"] as const;

/** 取出模型文本里的 JSON：直接解析 → 去围栏 → 第一个配平的 {...}。失败返回 undefined。 */
export function parseModelJson(raw: string): unknown {
  const attempt = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const direct = attempt(raw.trim());
  if (direct !== undefined) return direct;
  const unfenced = raw.replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/\s*```\s*$/, "");
  const second = attempt(unfenced.trim());
  if (second !== undefined) return second;
  const start = unfenced.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return attempt(unfenced.slice(start, i + 1));
  }
  return undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in obj) out[key] = obj[key];
  return out;
}

const toNumber = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v);
const toBool = (v: unknown) => (v === "true" ? true : v === "false" ? false : v);

export function normalizeCards(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item)) return item;
    const card = pick(item, ALLOWED_CARD);
    if ("position" in card) card.position = toNumber(card.position);
    if ("reversed" in card) card.reversed = toBool(card.reversed);
    return card;
  });
}

/** 读法：每项应是字符串。套了一层的字符串数组按句拼起来；{text} 对象取 text。个数不对就原样返回，交给校验拒绝。 */
export function normalizeInterpretations(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (Array.isArray(item) && item.every((x) => typeof x === "string")) return item.join("");
    if (isRecord(item) && typeof item.text === "string") return item.text;
    return item;
  });
}

export function normalizeSection(key: string, value: unknown): unknown {
  if (key === "cards") return normalizeCards(value);
  if (key === "interpretations") return normalizeInterpretations(value);
  return value;
}

function normalizeBody(value: unknown, allowed: readonly string[]): unknown {
  if (!isRecord(value)) return value;
  const out = pick(value, allowed);
  for (const key of Object.keys(out)) out[key] = normalizeSection(key, out[key]);
  return out;
}

export const normalizeReadingBody = (value: unknown) => normalizeBody(value, ALLOWED_TOP);
export const normalizePerspectiveBody = (value: unknown) => normalizeBody(value, ALLOWED_PERSPECTIVE);

/** 给“重试一次”用的提示：只列出字段位置与问题类型，不带任何用户内容。 */
export function repairNote(reasons: readonly string[]): string {
  return [
    "",
    "## 上一次输出没有通过检查",
    `问题：${reasons.slice(0, 6).join("；")}`,
    "请重新输出完整的 JSON 对象：严格按“输出字段”与“输出示例”，不要多余的字段，不要代码块，不要解释。",
  ].join("\n");
}

/** zod 问题 → 简短、不含内容的描述，如 `cards.N: unrecognized_keys`。 */
export function describeIssues(issues: readonly { path: readonly PropertyKey[]; code: string }[]): string[] {
  const seen = new Set<string>();
  for (const issue of issues) seen.add(`${issue.path.map((p) => (typeof p === "number" ? "N" : String(p))).join(".") || "(根)"}: ${issue.code}`);
  return [...seen];
}
