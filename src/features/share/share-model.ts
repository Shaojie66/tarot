// 分享图的内容模型。分享与私密备份是两个交付（docs/PLAN.md「导出边界」）：
// 这里只从“白名单字段”重新组装，绝不拷贝记录的其他部分——overall / 逐牌 text 可能复述用户原话，永远不属安全字段。
// 默认允许：牌名、正逆位、牌阵位置标签、牌的关键词、牌组署名、固定的项目名与免责声明。
// 默认禁止：问题、自解、解读正文、读法、小行动、反问、笔记、情绪标签、复盘、换视角内容、主题、日期时间、记录 id、站点地址。
// 个性化文本只有用户逐项勾选后才进入，并且生成前先预览。

import { getCard } from "@/features/cards/cards";
import { DECKS, cardImageSrc, type DeckId } from "@/features/cards/deck";
import { recordDeck, type ReadingRecord } from "@/features/reading/contract";
import { getSpread } from "@/features/reading/spread";

export const SHARE_TITLE = "此刻三张牌";
export const SHARE_DISCLAIMER = "自我反思工具，不预测未来。牌是随机抽的，怎么理解由你决定。";

/** 用户逐项主动选择才会进入分享图的个性化内容。默认全部关闭。 */
export interface ShareOptions {
  includeQuestion: boolean;
  includeAction: boolean;
}

export const DEFAULT_SHARE_OPTIONS: ShareOptions = { includeQuestion: false, includeAction: false };

export interface ShareCard {
  positionLabel: string;
  nameZh: string;
  reversed: boolean;
  keywords: [string, string, string];
  imageSrc: string;
}

export interface ShareModel {
  title: string;
  cards: ShareCard[];
  /** 牌组署名，例如“莱德-韦特 1909 原版” */
  attribution: string;
  disclaimer: string;
  deckId: DeckId;
  /** 仅在用户勾选时出现 */
  question?: string;
  action?: string;
}

/** 可以分享的小行动文本：用户明确决定过的（接受 → 建议原文；编辑 → 自己的版本）。未决定 / 跳过则没有。 */
export function shareableAction(record: ReadingRecord): string | null {
  const { status, text } = record.choice.action;
  if (status === "edited") return text || null;
  if (status === "accepted") return record.result.action;
  return null;
}

export function buildShareModel(record: ReadingRecord, options: ShareOptions = DEFAULT_SHARE_OPTIONS): ShareModel {
  const spread = getSpread(record.request.spreadId);
  const { deckId } = recordDeck(record);
  const model: ShareModel = {
    title: SHARE_TITLE,
    cards: record.request.cards.map((drawn) => {
      const card = getCard(drawn.cardId);
      const side = drawn.reversed ? card.reversed : card.upright;
      return {
        positionLabel: spread.positions[drawn.position].label,
        nameZh: card.nameZh,
        reversed: drawn.reversed,
        keywords: side.keywords,
        imageSrc: cardImageSrc(drawn.cardId, deckId),
      };
    }),
    attribution: DECKS[deckId].name,
    disclaimer: SHARE_DISCLAIMER,
    deckId,
  };
  if (options.includeQuestion) model.question = record.request.question;
  if (options.includeAction) {
    const action = shareableAction(record);
    if (action) model.action = action;
  }
  return model;
}

/** 用文字列出这张图里会出现的全部内容：给预览说明和读屏用，也是测试断言“没有多余内容”的依据。 */
export function describeShare(model: ShareModel): string {
  const lines = [
    model.title,
    ...model.cards.map((c) => `${c.positionLabel}：${c.nameZh}${c.reversed ? "（逆位）" : ""}（${c.keywords.join("、")}）`),
  ];
  if (model.question) lines.push(`我的问题：${model.question}`);
  if (model.action) lines.push(`我的小行动：${model.action}`);
  lines.push(`牌组：${model.attribution}`, model.disclaimer);
  return lines.join("\n");
}
