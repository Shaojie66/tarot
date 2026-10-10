// 导入 / 回读数据可靠性回归（docs/review-v1-2-2026-10-10.md 的 R1–R6 反例）。
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_KEY, DAILY_MAX_ENTRIES, loadDaily } from "@/features/daily/daily";
import { loadProfile } from "@/features/profile/profile";
import { MAX_RECALLS, RECALL_KEY, addRecall, loadAll, mergeRecalls, type Recall } from "@/features/recall/recall";
import { buildImportPlan, describeImportResult, parseBackup, type ImportPlan } from "./backup";
import { CONTENT_VERSION, RECORD_SCHEMA_VERSION, type ReadingRecord } from "./contract";
import { buildLocalReading } from "./local";
import { applyImport, clearEverything, deleteRecord, getRecord, saveRecord, snapshotForExport } from "./storage";

const request = {
  spreadId: "three-card" as const,
  topic: "crossroads" as const,
  originalQuestion: "走还是留",
  question: "走还是留",
  selfReading: "",
  cards: [
    { cardId: "the-hermit" as const, position: 0, reversed: false },
    { cardId: "six-of-swords" as const, position: 1, reversed: false },
    { cardId: "ace-of-pentacles" as const, position: 2, reversed: true },
  ],
};
const result = buildLocalReading(request);
const rec = (id: string, over: Partial<ReadingRecord> = {}): ReadingRecord => ({
  id,
  schemaVersion: RECORD_SCHEMA_VERSION,
  deckId: "rws-1909",
  settings: { allowReversed: true },
  createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(),
  request,
  result,
  choice: { interpretation: null, rejected: [], action: { status: "accepted", text: result.action } },
  versions: { content: CONTENT_VERSION, prompt: null, model: null },
  ...over,
});
const recall = (recordId: string, over: Partial<Recall> = {}): Recall => ({
  id: `recall-${recordId}`,
  recordId,
  dueAt: new Date(Date.UTC(2026, 9, 12)).toISOString(),
  status: "pending",
  createdAt: new Date(Date.UTC(2026, 9, 9)).toISOString(),
  completedAt: null,
  ...over,
});
const day = (dayKey: string) => ({ dayKey, timeZone: "UTC", drawnAt: `${dayKey}T08:00:00.000Z`, cardId: "the-fool" as const, reversed: false, deckId: "rws-1909" as const, settings: { allowReversed: true } });
const plan = (records: ReadingRecord[], extras: Partial<ImportPlan> = {}): ImportPlan => ({ records: records.map((incoming) => ({ incoming, expected: null })), dailyAdd: [], recallsAdd: [], profileApply: null, ...extras });
const fileOf = (extra: Record<string, unknown>, records: ReadingRecord[] = []) =>
  JSON.stringify({ format: "tarot-backup", backupVersion: 1, exportedAt: new Date(0).toISOString(), contentVersion: CONTENT_VERSION, records, ...extra });

function stubStorage() {
  const store = new Map<string, string>();
  const fail = { setItem: false };
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (fail.setItem) throw new Error("quota");
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
  });
  return { store, fail };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `record-${String(i).padStart(4, "0")}`);

describe("导入 / 回读数据可靠性", () => {
  let ls: ReturnType<typeof stubStorage>;
  beforeEach(async () => {
    ls = stubStorage();
    await clearEverything();
  });
  afterEach(() => vi.unstubAllGlobals());

  describe("R1 容量：不挤掉已有内容", () => {
    it("200 条回读 + 1 条新的 → 拒绝，原有 200 条逐项不变", () => {
      const full = ids(MAX_RECALLS).map((r) => recall(r));
      ls.store.set(RECALL_KEY, JSON.stringify(full));
      const before = ls.store.get(RECALL_KEY);
      expect(() => mergeRecalls([recall("record-9999")])).toThrow(/capacity/);
      expect(ls.store.get(RECALL_KEY)).toBe(before);
      // 满了之后新记录的回读也不挤掉旧的
      expect(addRecall("record-8888", 3)).toBeNull();
      expect(ls.store.get(RECALL_KEY)).toBe(before);
    });

    it("199 + 1 放得下", () => {
      ls.store.set(RECALL_KEY, JSON.stringify(ids(MAX_RECALLS - 1).map((r) => recall(r))));
      expect(mergeRecalls([recall("record-9999")]).added).toBe(1);
      expect(loadAll()).toHaveLength(MAX_RECALLS);
    });

    it("预检阶段按容量拒绝整个文件（回读 / 每日一张），旧合法备份不受影响", () => {
      const recordIds = ids(2);
      const existing = new Map(recordIds.map((id) => [id, rec(id)]));
      const over = parseBackup(fileOf({ recalls: [recall(recordIds[0])] }), existing, { recallRecordIds: new Set(), recallCount: MAX_RECALLS });
      expect(over).toMatchObject({ ok: false, reason: { kind: "over_capacity", what: "recalls" } });
      const keys = Array.from({ length: DAILY_MAX_ENTRIES }, (_, i) => `2024-01-${i}`);
      const overDaily = parseBackup(fileOf({ daily: [day("2030-01-01")] }), new Map(), { dailyKeys: new Set(keys) });
      expect(overDaily).toMatchObject({ ok: false, reason: { kind: "over_capacity", what: "daily" } });
      expect(parseBackup(fileOf({ daily: [day("2030-01-01")] }), new Map(), { dailyKeys: new Set(keys.slice(1)) }).ok).toBe(true);
      expect(parseBackup(fileOf({}), new Map(), { recallCount: MAX_RECALLS, dailyKeys: new Set(keys) }).ok).toBe(true);
    });

    it("每日一张在 applyImport 时也不会被挤掉", async () => {
      ls.store.set(DAILY_KEY, JSON.stringify(Array.from({ length: DAILY_MAX_ENTRIES }, (_, i) => day(new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10)))));
      const before = ls.store.get(DAILY_KEY);
      const r = await applyImport(plan([rec("record-0001")], { dailyAdd: [day("2030-01-01")] }));
      expect(r.status).toBe("stale");
      expect(ls.store.get(DAILY_KEY)).toBe(before);
      expect(await getRecord("record-0001")).toBeUndefined();
    });
  });

  describe("R2 / R3 回读身份与日期", () => {
    const base = recall("record-0001");
    const withRecord = (recalls: unknown[]) => parseBackup(fileOf({ recalls }, [rec("record-0001"), rec("record-0002")]), new Map());
    it("文件内重复 recall.id → 整个文件拒绝", () => {
      expect(withRecord([base, { ...recall("record-0002"), id: base.id }])).toMatchObject({ ok: false, reason: { kind: "invalid_recalls" } });
    });
    it("坏日期、空 createdAt、状态与完成时间矛盾 → 拒绝", () => {
      for (const bad of [
        { ...base, dueAt: "not-a-date" },
        { ...base, createdAt: "" },
        { ...base, status: "done", completedAt: null },
        { ...base, status: "pending", completedAt: new Date().toISOString() },
        { ...base, status: "done", completedAt: "garbage" },
      ]) {
        expect(withRecord([bad])).toMatchObject({ ok: false, reason: { kind: "invalid_recalls" } });
      }
    });
    it("合法的 pending / done 通过，带时区偏移的日期规范成 UTC", () => {
      const done = recall("record-0002", { status: "done", completedAt: "2026-10-13T08:00:00+08:00" });
      const parsed = withRecord([base, done]);
      if (!parsed.ok) throw new Error("expected ok");
      expect(parsed.preview.recallsAdd.map((r) => r.completedAt)).toEqual([null, "2026-10-13T00:00:00.000Z"]);
    });
    it("与本机同 id 却指向别的记录 → 单独计数，不算新增", () => {
      const parsed = parseBackup(fileOf({ recalls: [recall("record-0001")] }, [rec("record-0001")]), new Map(), { recallIds: new Set(["recall-record-0001"]), recallRecordIds: new Set(["record-0777"]) });
      if (!parsed.ok) throw new Error("expected ok");
      expect(parsed.preview.recallsAdd).toHaveLength(0);
      expect(parsed.preview.recallsIdConflict).toBe(1);
    });
  });

  describe("R4 / R5 确认时核对本机现状", () => {
    it("预览后本机完成建档 → 不被备份的意图覆盖", async () => {
      ls.store.set("tarot:profile:v1", JSON.stringify({ onboarded: true, intent: "decide", topics: [], recallCadence: null }));
      const r = await applyImport(plan([], { profileApply: { onboarded: true, intent: "clarify", topics: [], recallCadence: "3days" } }));
      expect(r.status).toBe("done");
      expect(loadProfile().intent).toBe("decide");
    });
    it("预览为新增的记录，之后本机保存了同 ID 的新版本 → stale，不覆盖，且什么都不写", async () => {
      const local = rec("record-0001", { review: { moods: [], note: "后来写的笔记", followUp: null, updatedAt: new Date().toISOString() } } as Partial<ReadingRecord>);
      await saveRecord(local);
      const r = await applyImport(plan([rec("record-0001"), rec("record-0002")], { dailyAdd: [day("2026-10-02")] }));
      expect(r.status).toBe("stale");
      expect(await getRecord("record-0001")).toEqual(local);
      expect(await getRecord("record-0002")).toBeUndefined();
      expect(loadDaily()).toHaveLength(0);
    });
    it("用户选了覆盖，但本机又被改过 → stale；预览后记录被删除也是 stale，不复活", async () => {
      const original = rec("record-0001");
      await saveRecord(original);
      const incoming = rec("record-0001", { createdAt: new Date(Date.UTC(2026, 9, 2)).toISOString() });
      await saveRecord({ ...original, choice: { ...original.choice, interpretation: 1 } });
      expect((await applyImport({ ...plan([]), records: [{ incoming, expected: original }] })).status).toBe("stale");
      await deleteRecord("record-0001");
      expect((await applyImport({ ...plan([]), records: [{ incoming, expected: original }] })).status).toBe("stale");
      expect(await getRecord("record-0001")).toBeUndefined();
    });
    it("幂等：同一份计划重试不重复、不报 stale", async () => {
      const p = plan([rec("record-0001")], { recallsAdd: [recall("record-0001")], dailyAdd: [day("2026-10-02")] });
      expect((await applyImport(p)).status).toBe("done");
      const again = await applyImport(p);
      expect(again.status).toBe("done");
      expect(loadAll()).toHaveLength(1);
      expect(loadDaily()).toHaveLength(1);
    });
    it("buildImportPlan：新增 expected=null，覆盖项带预览时的本机版本", () => {
      const local = rec("record-0001");
      const parsed = parseBackup(fileOf({}, [rec("record-0001", { createdAt: new Date(Date.UTC(2026, 9, 5)).toISOString() }), rec("record-0002")]), new Map([["record-0001", local]]));
      if (!parsed.ok) throw new Error("expected ok");
      expect(buildImportPlan(parsed.preview).records.map((r) => r.incoming.id)).toEqual(["record-0002"]);
      const withOverride = buildImportPlan(parsed.preview, new Set(["record-0001"]));
      expect(withOverride.records.find((r) => r.incoming.id === "record-0001")?.expected).toEqual(local);
    });
  });

  describe("R6 部分失败如实报告", () => {
    it("记录已写入后 localStorage 写入失败 → partial，不说“整批已回滚”，已写入的记录保留，重试补齐", async () => {
      const p = plan([rec("record-0001")], { recallsAdd: [recall("record-0001")], dailyAdd: [day("2026-10-02")] });
      ls.fail.setItem = true;
      const r = await applyImport(p);
      expect(r.status).toBe("partial");
      expect(r.steps.records).toMatchObject({ state: "ok", added: 1 });
      expect(r.steps.daily.state).toBe("failed");
      expect(r.steps.recalls.state).toBe("failed");
      expect(await getRecord("record-0001")).toBeDefined();
      const text = describeImportResult(r);
      expect(text).toContain("写入失败");
      expect(text).not.toContain("回滚");
      ls.fail.setItem = false;
      const retry = await applyImport(p);
      expect(retry.status).toBe("done");
      expect(loadAll()).toHaveLength(1);
      expect(loadDaily()).toHaveLength(1);
    });
    it("非法记录 → failed，localStorage 里的东西一个都没写", async () => {
      const bad = { ...rec("record-0009"), id: "x" } as ReadingRecord;
      const r = await applyImport(plan([bad], { recallsAdd: [recall("record-0001")], dailyAdd: [day("2026-10-02")], profileApply: { onboarded: true, intent: "decide", topics: [], recallCadence: null } }));
      expect(r.status).toBe("failed");
      expect(r.steps.daily.state).toBe("not_attempted");
      expect(loadAll()).toHaveLength(0);
      expect(ls.store.has(DAILY_KEY)).toBe(false);
      expect(ls.store.has("tarot:profile:v1")).toBe(false);
    });
    it("清空时 localStorage 部分失败 → 列出没清掉的项，不谎称全部清空", async () => {
      ls.store.set(RECALL_KEY, JSON.stringify([recall("record-0001")]));
      vi.stubGlobal("localStorage", { getItem: ls.store.get.bind(ls.store), setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } });
      const { failed } = await clearEverything();
      expect(failed).toEqual(expect.arrayContaining(["daily", "draft", "recalls"]));
    });
  });

  describe("导出读最新数据", () => {
    it("snapshotForExport 读到页面加载之后新增的记录", async () => {
      await saveRecord(rec("record-0001"));
      await saveRecord(rec("record-0002", { createdAt: new Date(Date.UTC(2026, 9, 3)).toISOString() }));
      const snap = await snapshotForExport();
      expect(snap.records.map((r) => r.id).sort()).toEqual(["record-0001", "record-0002"]);
      expect(snap.unreadable).toBe(0);
    });
  });
});
