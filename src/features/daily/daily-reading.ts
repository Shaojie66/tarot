// 每日一张的文案：独立的一张牌，不套三张牌的“此刻 / 阻碍 / 下一步”模板。
// 只用牌义里的关键词、牌义、反思问题，加一句固定的小提示；不预测、不断言。

import { getCard } from "@/features/cards/cards";
import type { CardId } from "@/features/cards/ids";

export interface DailyReading {
  nameZh: string;
  nameEn: string;
  reversed: boolean;
  keywords: [string, string, string];
  /** 这张牌描述的状态（牌义，不是对今天的预言） */
  meaning: string;
  /** 一个开放的反思问题 */
  question: string;
  /** 留给今天的一个小观察，不是任务 */
  notice: string;
}

const NOTICE_UPRIGHT = "今天不用做什么，只留意一次：什么时候，你会想起这几个词。";
const NOTICE_REVERSED = "逆位可以理解为这股力量被卡住、过度或向内。今天只留意一次：它在哪个瞬间出现。";

export function buildDailyReading(cardId: CardId, reversed: boolean): DailyReading {
  const card = getCard(cardId);
  const side = reversed ? card.reversed : card.upright;
  return {
    nameZh: card.nameZh,
    nameEn: card.nameEn,
    reversed,
    keywords: side.keywords,
    meaning: side.meaning,
    question: side.question,
    notice: reversed ? NOTICE_REVERSED : NOTICE_UPRIGHT,
  };
}
