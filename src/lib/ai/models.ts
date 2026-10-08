// 全站唯一的模型配置。业务代码按"用途"取模型，不直接写模型 ID。

export const MODELS = {
  /** 问题改写、免费短解读、危机分类：量大、要快、要便宜 */
  fast: "claude-haiku-5-5",
  /** 换个视角、深度解读：质量优先 */
  deep: "claude-sonnet-5-5",
} as const;

export type ModelTier = keyof typeof MODELS;
