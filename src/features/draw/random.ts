// 抽牌随机性的唯一来源。红线：只用 crypto.getRandomValues，模型永远不参与选牌。

export type RandomInt = (maxExclusive: number) => number;

/** 无偏的 [0, maxExclusive) 整数，用拒绝采样消除取模偏差。 */
export const cryptoRandomInt: RandomInt = (maxExclusive) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
    throw new RangeError(`maxExclusive out of range: ${maxExclusive}`);
  }
  const limit = 2 ** 32 - (2 ** 32 % maxExclusive);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
};

/** Fisher–Yates，返回新数组。 */
export function shuffle<T>(items: readonly T[], randomInt: RandomInt = cryptoRandomInt): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
