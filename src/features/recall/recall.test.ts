import { beforeEach, describe, expect, it, vi } from "vitest";
import { addRecall, clearAllRecalls, dismissRecall, dueAfter, expiredRecalls, loadAll, markDone, removeRecallsForRecord } from "./recall";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

const R1 = "rec-000000000000000000000000001";
const R2 = "rec-000000000000000000000000002";

describe("recall", () => {
  beforeEach(() => {
    store.clear();
  });

  it("addRecall 创建 pending 条目，到期时间基于调用时 + 天数", () => {
    const item = addRecall(R1, 3);
    expect(item).not.toBeNull();
    expect(item!.recordId).toBe(R1);
    expect(item!.status).toBe("pending");
    expect(item!.dueAt).toBe(dueAfter(3, new Date(item!.createdAt)));
  });

  it("同一条记录只安排一次：重复调用返回已有条目，处理 / 忽略过的也不再新增", () => {
    const first = addRecall(R1, 3)!;
    expect(addRecall(R1, 7)).toEqual(first);
    expect(loadAll()).toHaveLength(1);
    dismissRecall(first.id);
    addRecall(R1, 3);
    expect(loadAll()).toHaveLength(1);
    addRecall(R2, 3);
    expect(loadAll()).toHaveLength(2);
  });

  it("过期判断：未到期不出现，到期后出现，且忽略 done/dismissed", () => {
    addRecall(R1, 3);
    expect(expiredRecalls(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))).toHaveLength(0);
    expect(expiredRecalls(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000))).toHaveLength(1);

    const [item] = loadAll();
    markDone(item!.id);
    expect(expiredRecalls(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000))).toHaveLength(0);
  });

  it("markDone / dismissRecall 标记后不再进入到期池", () => {
    addRecall(R1, 1);
    const [item] = loadAll();
    dismissRecall(item!.id);
    expect(loadAll()[0].status).toBe("dismissed");
    expect(expiredRecalls(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))).toHaveLength(0);
  });

  it("删除记录时级联清理指向它的回读", () => {
    addRecall(R1, 1);
    addRecall(R2, 1);
    removeRecallsForRecord(R1);
    const list = loadAll();
    expect(list).toHaveLength(1);
    expect(list[0].recordId).toBe(R2);
  });

  it("clearAllRecalls 清空", () => {
    addRecall(R1, 1);
    clearAllRecalls();
    expect(loadAll()).toHaveLength(0);
  });
});
