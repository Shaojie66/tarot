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

/** 叙述虚构、新闻或牌义的语境标记；同一分句里没有"我想 / 我要"这类第一人称意图时视为非危机。 */
const FICTION_MARKERS = /小说|电影|电视剧|剧里|剧中|故事|角色|主角|书里|游戏里|动漫|历史上|新闻|牌义|这张牌/;
const FIRST_PERSON_INTENT =
  /我(也|真的|好|很|一直|有时|总是)?(想|要|准备|打算|会)(去)?(自杀|死|跳|割|轻生|结束|了结|伤害|自残)|\bI (want|wanna|will|am going) to (die|kill)/i;

export interface CrisisCheck {
  flagged: boolean;
}

export function detectCrisis(...texts: (string | undefined | null)[]): CrisisCheck {
  for (const text of texts) {
    if (!text) continue;
    const clauses = text.split(/[。！？!?；;\n]+/);
    for (const clause of clauses) {
      if (!CRISIS_PATTERNS.some((re) => re.test(clause))) continue;
      if (FICTION_MARKERS.test(clause) && !FIRST_PERSON_INTENT.test(clause)) continue;
      return { flagged: true };
    }
  }
  return { flagged: false };
}
