// "牌这次想帮你做什么"。纯数据，无 React / 浏览器依赖：契约、提示词、本地解读都要用它。
// null / 未设置 = 中性默认（理清处境式的平实语气）。

export const INTENTS = ["clarify", "decide", "companion"] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABELS: Record<Intent, string> = {
  clarify: "理清现在的处境",
  decide: "做个决定",
  companion: "只是陪我说说话",
};
