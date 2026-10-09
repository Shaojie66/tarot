// 本地危机分流规则。无 key 时唯一的一道检查，有 key 时与模型标记并行（取并集）。
// 局限：关键词规则会漏掉隐晦表达，也可能误伤；评测集分别统计漏拦和误拦，见 evals/safety/。

const CRISIS_PATTERNS: readonly RegExp[] = [
  /自杀(?!式)/,
  /轻生/,
  /想死(?![你我他她])/,
  /不想活/,
  /活不下去/,
  /不想再活/,
  /活着(没|没有)(意思|意义)/,
  /没有活下去的(理由|意义|必要)/,
  /结束(自己的|我的)?生命/,
  /了结(自己|我自己)/,
  /死了算了/,
  /一了百了/,
  /自残/,
  /自伤/,
  /割腕/,
  /伤害自己/,
  /(想|要|准备)(去)?跳楼/,
  /(想|要|准备)(去)?跳河/,
  /(攒|囤|吞|吃了?很多|吃一整瓶)安眠药/,
  /写(好了)?遗书/,
  /安排(好)?后事/,
  /kill (myself|me)/i,
  /suicid/i,
  /self[- ]?harm/i,
  /want(ed)? to die/i,
  /end (my|it) all/i,
];

/** 叙述虚构、新闻或牌义的语境标记。同一句里出现时，只有"并非说话人本人"的危机表述才被豁免。 */
const FICTION_MARKERS = /小说|电影|电视剧|剧里|剧中|故事|角色|主角|书里|游戏里|动漫|历史上|新闻|牌义|这张牌/;
/** 说话人自指。危机词前紧邻（6 字内）出现自指，视为本人表述，语境标记不能豁免。 */
const SPEAKER = /我|\bI\b|\bmy(self)?\b/gi;
const SPEAKER_WINDOW = 6;

export interface CrisisCheck {
  flagged: boolean;
}

function aboutSpeaker(subclause: string, matchIndex: number): boolean {
  const before = subclause.slice(0, matchIndex);
  const last = [...before.matchAll(SPEAKER)].pop();
  return last !== undefined && before.length - (last.index + last[0].length) <= SPEAKER_WINDOW;
}

/**
 * 规则：命中危机词即分流，除非该句带有虚构 / 新闻语境标记，且该危机词不是说话人本人的表述。
 * 例："看完这部电影，我不想活了"仍分流；"小说里的主角想自杀"不分流。
 * 第三方危机（"朋友说她想自杀"）有意分流：写下它的人也可能需要支持，页面提供"返回修改"。
 */
export function detectCrisis(...texts: (string | undefined | null)[]): CrisisCheck {
  for (const text of texts) {
    if (!text) continue;
    for (const sentence of text.split(/[。！？!?；;\n]+/)) {
      const fictional = FICTION_MARKERS.test(sentence);
      for (const sub of sentence.split(/[，,、：:]+/)) {
        for (const re of CRISIS_PATTERNS) {
          const match = re.exec(sub);
          if (!match) continue;
          if (!fictional || aboutSpeaker(sub, match.index)) return { flagged: true };
        }
      }
    }
  }
  return { flagged: false };
}
