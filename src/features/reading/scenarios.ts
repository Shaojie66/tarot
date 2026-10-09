// 情境卡：把"选题 + 出题"合并成一步的入口（浮罗绘心式克制问句，非推销腔）。
// 点卡即进入抽牌快路径；"此刻"卡对应"无题也抽"共识，用陪伴语气。
// 保留"自己写一个问题"作为次级高级入口（走原有 chooseTopic / submitQuestion 路径）。

import type { Topic } from "@/features/cards/schema";

export type ScenarioId = Topic | "topicless";

export interface Scenario {
  id: ScenarioId;
  /** 卡片主问句（克制、第二人称、反思式，不以"纠结推销"口吻） */
  question: string;
  /** 对应的牌义主题；topicless 复用 self 主题但带标记 */
  topic: Topic;
  /** 是否为"没有具体问题，只想看看此刻的自己" */
  topicless: boolean;
}

export const SCENARIOS: Scenario[] = [
  { id: "relationship", question: "这段关系里，我在看不清什么？", topic: "relationship", topicless: false },
  { id: "career", question: "留在原地，还是换个方向？", topic: "career", topicless: false },
  { id: "self", question: "我在跟自己较什么劲？", topic: "self", topicless: false },
  { id: "crossroads", question: "两个选项之间，我在怕什么？", topic: "crossroads", topicless: false },
  { id: "topicless", question: "没有具体问题，就想看看此刻的自己。", topic: "self", topicless: true },
];

export function getScenario(id: ScenarioId): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/**
 * 按建档时选的“常来的主题”排序：偏好的主题卡排前面（保持原有相对顺序），“此刻”无题卡始终在最后。
 * 没选偏好就是默认顺序。只改排序，不过滤：每张卡都还在。
 */
export function orderScenarios(preferred: readonly Topic[]): Scenario[] {
  const rank = (s: Scenario) => (s.topicless ? 2 : preferred.includes(s.topic) ? 0 : 1);
  return [...SCENARIOS].sort((a, b) => rank(a) - rank(b));
}
