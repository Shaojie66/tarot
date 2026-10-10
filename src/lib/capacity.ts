/** 本地存储容量已满：导入 / 合并时整批拒绝，不为了容纳新内容而挤掉已有内容。 */
export class CapacityError extends Error {
  constructor(what: string) {
    super(`${what} capacity exceeded`);
    this.name = "CapacityError";
  }
}
