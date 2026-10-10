import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_VERSION, type ImportPlan, MAX_BACKUP_BYTES, backupFileName, buildBackup, parseBackup, recordsToWrite, stableStringify } from "./backup";
import { CONTENT_VERSION, RECORD_SCHEMA_VERSION, type Perspective, type ReadingRecord, type Review } from "./contract";
import { buildLocalReading } from "./local";
import { addPerspective, applyImport, clearEverything, deleteRecord, getRecord, listRecords, saveFlowRecord, saveRecord, updateReview, writeImported } from "./storage";

function makeRecord(id: string, over: Partial<ReadingRecord> = {}, seed = 0): ReadingRecord {
  const request = {
    spreadId: "three-card" as const,
    topic: "crossroads" as const,
    originalQuestion: `走还是留 ${seed}`,
    question: `走还是留 ${seed}`,
    selfReading: "合成自解：中间那张让我不舒服",
    cards: [
      { cardId: "the-hermit" as const, position: 0, reversed: false },
      { cardId: "six-of-swords" as const, position: 1, reversed: false },
      { cardId: "ace-of-pentacles" as const, position: 2, reversed: true },
    ],
  };
  const result = buildLocalReading(request);
  return {
    id,
    schemaVersion: RECORD_SCHEMA_VERSION,
    deckId: "rws-1909",
    settings: { allowReversed: true },
    createdAt: new Date(Date.UTC(2026, 9, 9, 8, seed)).toISOString(),
    request,
    result,
    choice: { interpretation: 1, rejected: [0], action: { status: "edited", text: "合成：今晚写三行" } },
    versions: { content: CONTENT_VERSION, prompt: null, model: null },
    ...over,
  } as ReadingRecord;
}

const review: Review = {
  moods: ["迷茫", "期待"],
  note: "合成笔记：回头看，当时最在意的是自由",
  followUp: { status: "partial", note: "做了一半", at: new Date(Date.UTC(2026, 9, 10)).toISOString() },
  updatedAt: new Date(Date.UTC(2026, 9, 10)).toISOString(),
};

const toMap = (records: ReadingRecord[]) => new Map(records.map((r) => [r.id, r]));
const file = (records: unknown[], over: object = {}) =>
  JSON.stringify({ format: "tarot-backup", backupVersion: BACKUP_VERSION, exportedAt: new Date(0).toISOString(), contentVersion: "x", records, ...over });

beforeEach(async () => {
  await clearEverything();
});

describe("备份往返", () => {
  it("导出 → 清空 → 导入：记录（含 v1 旧记录、笔记、复盘、选择）无损", async () => {
    const v1 = (() => {
      const r = makeRecord("legacy-0001", {}, 1) as Record<string, unknown>;
      delete r.deckId;
      delete r.settings;
      r.schemaVersion = 1;
      return r as unknown as ReadingRecord;
    })();
    const withReview = makeRecord("record-0002", { review }, 2);
    const plain = makeRecord("record-0003", {}, 3);
    await writeImported([v1, withReview, plain]);

    const before = (await listRecords()).records;
    const text = JSON.stringify(buildBackup(before));
    await clearEverything();
    expect((await listRecords()).records).toHaveLength(0);

    const parsed = parseBackup(text, new Map());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.preview.add).toHaveLength(3);
    await writeImported(recordsToWrite(parsed.preview));

    const after = (await listRecords()).records;
    expect(stableStringify(after.sort((a, b) => a.id.localeCompare(b.id)))).toBe(stableStringify(before.sort((a, b) => a.id.localeCompare(b.id))));
    // v1 旧记录不被伪造牌组字段，仍是 v1
    const legacy = await getRecord("legacy-0001");
    expect(legacy?.schemaVersion).toBe(1);
    expect(legacy && "deckId" in legacy).toBe(false);
  });

  it("备份不含草稿 / 密钥 / 设备信息，文件名不含问题文字", () => {
    const record = makeRecord("record-0001");
    const backup = buildBackup([record], new Date(Date.UTC(2026, 9, 9)));
    expect(Object.keys(backup).sort()).toEqual(["backupVersion", "contentVersion", "daily", "exportedAt", "format", "profile", "recalls", "records"]);
    const name = backupFileName(new Date(Date.UTC(2026, 9, 9)), "ab12cd34");
    expect(name).toBe("tarot-backup-20261009-ab12cd.json");
    expect(name).not.toContain("走还是留");
  });
});

describe("预检：整个文件要么全部可用，要么拒绝，不导入一半", () => {
  it("拒绝未来版本 / 无效版本 / 不是备份 / 不是 JSON / 过大", () => {
    const m = new Map();
    expect(parseBackup(file([], { backupVersion: BACKUP_VERSION + 1 }), m)).toMatchObject({ ok: false, reason: { kind: "future_version" } });
    expect(parseBackup(file([], { backupVersion: 0 }), m)).toMatchObject({ ok: false, reason: { kind: "bad_version" } });
    expect(parseBackup(file([], { backupVersion: "1" }), m)).toMatchObject({ ok: false, reason: { kind: "bad_version" } });
    expect(parseBackup(file([], { format: "other" }), m)).toMatchObject({ ok: false, reason: { kind: "not_a_backup" } });
    expect(parseBackup("[]", m)).toMatchObject({ ok: false, reason: { kind: "not_a_backup" } });
    expect(parseBackup("{oops", m)).toMatchObject({ ok: false, reason: { kind: "not_json" } });
    expect(parseBackup(" ".repeat(MAX_BACKUP_BYTES + 1), m)).toMatchObject({ ok: false, reason: { kind: "too_large" } });
  });

  it("坏记录（未知牌 / 结果与抽牌不一致 / 选择自相矛盾 / 缺字段）拒绝整个文件，即使其他记录有效", () => {
    const good = makeRecord("record-0001");
    const unknownCard = structuredClone(makeRecord("record-0002")) as ReadingRecord;
    (unknownCard.request.cards[0] as { cardId: string }).cardId = "not-a-card";
    const mismatch = structuredClone(makeRecord("record-0003")) as ReadingRecord;
    mismatch.result.cards[0].cardId = "the-sun";
    const contradictory = makeRecord("record-0004", { choice: { interpretation: 0, rejected: [0], action: { status: "undecided", text: "" } } });
    const missing = { ...makeRecord("record-0005") } as Record<string, unknown>;
    delete missing.request;
    for (const bad of [unknownCard, mismatch, contradictory, missing]) {
      const parsed = parseBackup(file([good, bad]), new Map());
      expect(parsed).toMatchObject({ ok: false, reason: { kind: "invalid_records", total: 1 } });
    }
  });

  it("文件内重复 ID 拒绝（即使内容相同）", () => {
    const r = makeRecord("record-0001");
    expect(parseBackup(file([r, r]), new Map())).toMatchObject({ ok: false, reason: { kind: "duplicate_ids", ids: ["record-0001"] } });
  });

  it("拒绝的文件不写任何东西", async () => {
    await writeImported([makeRecord("record-0001")]);
    const parsed = parseBackup(file([makeRecord("record-0002"), { id: "broken" }]), toMap((await listRecords()).records));
    expect(parsed.ok).toBe(false);
    expect((await listRecords()).records.map((r) => r.id)).toEqual(["record-0001"]);
  });
});

describe("冲突与跳过", () => {
  it("相同 ID + 相同内容 → 跳过；相同 ID + 不同内容 → 冲突，默认保留本机", async () => {
    const same = makeRecord("record-0001");
    const local = makeRecord("record-0002", {}, 2);
    const incomingDifferent = makeRecord("record-0002", { choice: { interpretation: 0, rejected: [], action: { status: "skipped", text: "" } } }, 2);
    const fresh = makeRecord("record-0003", {}, 3);
    await writeImported([same, local]);
    const existing = toMap((await listRecords()).records);

    const parsed = parseBackup(file([same, incomingDifferent, fresh]), existing);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.preview.skip.map((r) => r.id)).toEqual(["record-0001"]);
    expect(parsed.preview.add.map((r) => r.id)).toEqual(["record-0003"]);
    expect(parsed.preview.conflicts.map((c) => c.incoming.id)).toEqual(["record-0002"]);

    // 默认：只导入新增
    await writeImported(recordsToWrite(parsed.preview));
    expect((await getRecord("record-0002"))?.choice.action.status).toBe("edited");
    expect(await getRecord("record-0003")).toBeDefined();

    // 明确选择后才覆盖
    await writeImported(recordsToWrite(parsed.preview, new Set(["record-0002"])));
    expect((await getRecord("record-0002"))?.choice.action.status).toBe("skipped");
  });

  it("键顺序不同但内容相同 → 视为相同", () => {
    const r = makeRecord("record-0001");
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(r).reverse())));
    const parsed = parseBackup(file([reordered]), toMap([r]));
    expect(parsed.ok && parsed.preview.skip).toHaveLength(1);
  });
});

describe("事务写入", () => {
  it("批次中有一条不合法 → 整批不写入", async () => {
    await writeImported([makeRecord("record-0001")]);
    const bad = { ...makeRecord("record-0003"), id: "x" } as ReadingRecord;
    await expect(writeImported([makeRecord("record-0002"), bad])).rejects.toThrow();
    expect((await listRecords()).records.map((r) => r.id)).toEqual(["record-0001"]);
  });
});

describe("回看内容与流程保存互不覆盖", () => {
  it("updateReview 只改 review；清除后字段消失", async () => {
    const r = makeRecord("record-0001");
    await saveRecord(r);
    const updated = await updateReview(r.id, review);
    expect(updated.review).toEqual(review);
    expect((await getRecord(r.id))?.choice).toEqual(r.choice);
    const cleared = await updateReview(r.id, null);
    expect("review" in cleared).toBe(false);
  });

  it("流程用过期状态保存选择，不会抹掉历史里补写的 review，也不改写旧记录的版本", async () => {
    const r = makeRecord("record-0001");
    await saveRecord(r);
    await updateReview(r.id, review);
    await saveFlowRecord({ ...r, choice: { interpretation: 0, rejected: [], action: { status: "accepted", text: r.result.action } } });
    const after = await getRecord(r.id);
    expect(after?.review).toEqual(review);
    expect(after?.choice.action.status).toBe("accepted");

    const legacy = (() => {
      const x = makeRecord("legacy-0002", {}, 2) as Record<string, unknown>;
      delete x.deckId;
      delete x.settings;
      x.schemaVersion = 1;
      return x as unknown as ReadingRecord;
    })();
    await saveRecord(legacy);
    await saveFlowRecord({ ...makeRecord("legacy-0002", {}, 2), choice: { interpretation: null, rejected: [], action: { status: "skipped", text: "" } } });
    const kept = await getRecord("legacy-0002");
    expect(kept?.schemaVersion).toBe(1);
    expect(kept && "deckId" in kept).toBe(false);
    expect(kept?.choice.action.status).toBe("skipped");
  });
});

describe("列表、删除、清空", () => {
  it("新的在前；损坏条目不进入列表也不使列表崩溃，且原样保留", async () => {
    await writeImported([makeRecord("record-0001", {}, 1), makeRecord("record-0002", {}, 5)]);
    const { default: Dexie } = await import("dexie");
    const raw = new Dexie("tarot");
    raw.version(1).stores({ records: "id, createdAt" });
    await raw.table("records").put({ id: "corrupt-0001", createdAt: new Date(Date.UTC(2026, 9, 9, 9)).toISOString(), junk: true });
    raw.close();
    const list = await listRecords();
    expect(list.records.map((r) => r.id)).toEqual(["record-0002", "record-0001"]);
    expect(list.unreadable).toBe(1);
  });

  it("删除单条；清空包含记录与草稿键", async () => {
    await writeImported([makeRecord("record-0001"), makeRecord("record-0002", {}, 2)]);
    await deleteRecord("record-0001");
    expect((await listRecords()).records.map((r) => r.id)).toEqual(["record-0002"]);
    await clearEverything();
    const list = await listRecords();
    expect(list.records).toHaveLength(0);
    expect(list.unreadable).toBe(0);
  });
});

describe("每日一张随备份往返", () => {
  const day = (dayKey: string, cardId = "the-fool") => ({
    dayKey,
    timeZone: "Europe/London",
    drawnAt: `${dayKey}T08:00:00.000Z`,
    cardId,
    reversed: false,
    deckId: "rws-1909",
    settings: { allowReversed: true },
  });

  it("导出含 daily；导入补本机没有的日键，已有的不覆盖；旧备份（无 daily 字段）照常可导入", () => {
    const withDaily = JSON.parse(file([makeRecord("record-0001")], { daily: [day("2026-10-01"), day("2026-10-02")] }));
    const parsed = parseBackup(JSON.stringify(withDaily), new Map(), { dailyKeys: new Set(["2026-10-01"]) });
    expect(parsed.ok && parsed.preview.dailyAdd.map((d) => d.dayKey)).toEqual(["2026-10-02"]);
    expect(parsed.ok && parsed.preview.dailySkip).toBe(1);

    const old = parseBackup(file([makeRecord("record-0001")]), new Map());
    expect(old.ok && old.preview.dailyAdd).toEqual([]);
    expect(buildBackup([], new Date(0), [day("2026-10-02") as never, day("2026-10-01") as never]).daily.map((d) => d.dayKey)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("坏的每日记录 / 重复日键 → 拒绝整个文件", () => {
    expect(parseBackup(file([], { daily: [{ dayKey: "bad" }] }), new Map())).toMatchObject({ ok: false, reason: { kind: "invalid_daily" } });
    expect(parseBackup(file([], { daily: [day("2026-10-01"), day("2026-10-01")] }), new Map())).toMatchObject({ ok: false, reason: { kind: "invalid_daily" } });
    expect(parseBackup(file([], { daily: "nope" }), new Map())).toMatchObject({ ok: false, reason: { kind: "invalid_daily" } });
  });
});

const plan = (records: ReadingRecord[], extras: Partial<ImportPlan> = {}): ImportPlan => ({
  records: records.map((incoming) => ({ incoming, expected: null })),
  dailyAdd: [],
  recallsAdd: [],
  profileApply: null,
  ...extras,
});

describe("applyImport：非法记录在任何写入之前就被拦下", () => {
  it("记录校验失败 → 什么都不写，每日一张保持导入前", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    store.set("tarot:daily:v1", JSON.stringify([{ dayKey: "2026-09-01", timeZone: "UTC", drawnAt: "2026-09-01T08:00:00.000Z", cardId: "death", reversed: false, deckId: "rws-1909", settings: { allowReversed: true } }]));
    const before = store.get("tarot:daily:v1");
    const bad = { ...makeRecord("record-0009"), id: "x" } as ReadingRecord;
    const newDay = { dayKey: "2026-10-02", timeZone: "UTC", drawnAt: "2026-10-02T08:00:00.000Z", cardId: "the-fool" as const, reversed: false, deckId: "rws-1909" as const, settings: { allowReversed: true } };
    const result = await applyImport(plan([bad], { dailyAdd: [newDay] }));
    expect(result.status).toBe("failed");
    expect(store.get("tarot:daily:v1")).toBe(before);
    vi.unstubAllGlobals();
  });
});

describe("换视角快照", () => {
  const perspective = (tone: Perspective["tone"]): Perspective => ({
    id: `persp-${tone}-0001`,
    tone,
    createdAt: new Date(Date.UTC(2026, 9, 12)).toISOString(),
    source: "ai",
    versions: { content: CONTENT_VERSION, prompt: "v3", model: "claude-sonnet-5-5" },
    body: { overall: "合成换视角：换个角度看。", interpretations: ["合成读法甲", "合成读法乙"], question: "合成：你想先弄清楚什么？" },
  });

  it("追加视角不改原解读 / 选择 / 回看；同一语气不重复追加；备份往返无损", async () => {
    const r = makeRecord("record-0001", { review });
    await saveRecord(r);
    const after = await addPerspective(r.id, perspective("support"));
    expect(after.perspectives).toHaveLength(1);
    expect(after.result).toEqual(r.result);
    expect(after.choice).toEqual(r.choice);
    expect(after.review).toEqual(review);

    const again = await addPerspective(r.id, { ...perspective("support"), id: "persp-support-0002" });
    expect(again.perspectives).toHaveLength(1);
    expect(again.perspectives?.[0].id).toBe("persp-support-0001");
    await addPerspective(r.id, perspective("rational"));

    const before = (await listRecords()).records;
    const text = JSON.stringify(buildBackup(before));
    await clearEverything();
    const parsed = parseBackup(text, new Map());
    if (!parsed.ok) throw new Error("expected ok");
    await writeImported(recordsToWrite(parsed.preview));
    expect(stableStringify((await listRecords()).records)).toBe(stableStringify(before));
    expect((await getRecord(r.id))?.perspectives?.map((p) => p.tone)).toEqual(["support", "rational"]);
  });

  it("流程保存（只更新 choice）不会抹掉已有视角", async () => {
    const r = makeRecord("record-0002", {}, 2);
    await saveRecord(r);
    await addPerspective(r.id, perspective("challenge"));
    await saveFlowRecord({ ...r, choice: { interpretation: 0, rejected: [], action: { status: "accepted", text: r.result.action } } });
    const kept = await getRecord(r.id);
    expect(kept?.perspectives).toHaveLength(1);
    expect(kept?.choice.action.status).toBe("accepted");
  });

  it("预检拒绝：同一记录里重复的语气", () => {
    const r = makeRecord("record-0003", { perspectives: [perspective("support"), { ...perspective("support"), id: "persp-support-0009" }] }, 3);
    expect(parseBackup(file([r]), new Map())).toMatchObject({ ok: false, reason: { kind: "invalid_records" } });
  });
});

describe("回读与建档随备份往返", () => {
  const ID_A = "record-0001";
  const ID_B = "record-0002";
  const recall = (recordId: string, id = `recall-${recordId}`) => ({
    id,
    recordId,
    dueAt: new Date(Date.UTC(2026, 9, 12)).toISOString(),
    status: "pending" as const,
    createdAt: new Date(Date.UTC(2026, 9, 9)).toISOString(),
    completedAt: null,
  });
  const profile = { onboarded: true, intent: "decide" as const, topics: ["career" as const], recallCadence: "3days" as const };

  it("buildBackup：回读只带“指向的记录也在备份里”的；没建档就没有 profile", () => {
    const b = buildBackup([makeRecord(ID_A)], new Date(0), { recalls: [recall(ID_A), recall("record-9999")], profile: { ...profile, onboarded: false } });
    expect(b.recalls.map((r) => r.recordId)).toEqual([ID_A]);
    expect(b.profile).toBeNull();
    expect(buildBackup([makeRecord(ID_A)], new Date(0), { profile }).profile).toEqual(profile);
  });

  it("预览：指向的记录存在（本机已有或随本次导入）且本机没有回读的才补；孤儿 / 已有的跳过", () => {
    const local = new Map([[ID_B, makeRecord(ID_B, {}, 2)]]);
    const text = file([makeRecord(ID_A)], { recalls: [recall(ID_A), recall(ID_B), recall("record-0003")] });
    // 本机：有记录 B，且 B 已经有回读
    const parsed = parseBackup(text, local, { recallRecordIds: new Set([ID_B]) });
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.preview.recallsAdd.map((r) => r.recordId)).toEqual([ID_A]);
    expect(parsed.preview.recallsSkip).toBe(2);
  });

  it("预览：建档只在本机还没建档时采用；已建档的本机不覆盖", () => {
    const text = file([], { profile });
    const fresh = parseBackup(text, new Map(), { profileOnboarded: false });
    const used = parseBackup(text, new Map(), { profileOnboarded: true });
    if (!fresh.ok || !used.ok) throw new Error("expected ok");
    expect(fresh.preview.profileApply).toEqual(profile);
    expect(fresh.preview.profileIgnored).toBe(false);
    expect(used.preview.profileApply).toBeNull();
    expect(used.preview.profileIgnored).toBe(true);
    // 没有 profile 字段 / 为 null 的旧备份照常导入
    for (const t of [file([]), file([], { profile: null })]) {
      const p = parseBackup(t, new Map());
      expect(p.ok && p.preview.profileApply).toBeNull();
    }
  });

  it("坏的回读 / 重复回读 / 坏的建档 → 拒绝整个文件", () => {
    expect(parseBackup(file([], { recalls: [{ id: "x" }] }), new Map())).toMatchObject({ ok: false, reason: { kind: "invalid_recalls" } });
    expect(parseBackup(file([makeRecord(ID_A)], { recalls: [recall(ID_A), recall(ID_A, "recall-other-0002")] }), new Map())).toMatchObject({ ok: false, reason: { kind: "invalid_recalls" } });
    expect(parseBackup(file([], { recalls: "nope" }), new Map())).toMatchObject({ ok: false, reason: { kind: "invalid_recalls" } });
    for (const bad of [{ ...profile, intent: "angry" }, { ...profile, topics: ["nope"] }, { ...profile, extra: 1 }, { onboarded: true }, "str"]) {
      expect(parseBackup(file([], { profile: bad }), new Map())).toMatchObject({ ok: false, reason: { kind: "invalid_profile" } });
    }
  });

  describe("applyImport：全部写入或全部不写", () => {
    function stubStorage() {
      const store = new Map<string, string>();
      vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
      return store;
    }

    it("成功：记录、回读、建档都写入", async () => {
      const store = stubStorage();
      const result = await applyImport(plan([makeRecord(ID_A)], { recallsAdd: [recall(ID_A)], profileApply: profile }));
      expect(result.status).toBe("done");
      expect((await getRecord(ID_A))?.id).toBe(ID_A);
      expect(JSON.parse(store.get("tarot:recall:v1")!)).toHaveLength(1);
      expect(JSON.parse(store.get("tarot:profile:v1")!)).toMatchObject({ onboarded: true, intent: "decide" });
      vi.unstubAllGlobals();
    });

    it("记录校验失败：回读与建档都没有被写入（包括原本为空）", async () => {
      const store = stubStorage();
      store.set("tarot:recall:v1", JSON.stringify([recall("record-0777")]));
      const before = store.get("tarot:recall:v1");
      const bad = { ...makeRecord("record-0009"), id: "x" } as ReadingRecord;
      expect((await applyImport(plan([bad], { recallsAdd: [recall(ID_B)], profileApply: profile }))).status).toBe("failed");
      expect(store.get("tarot:recall:v1")).toBe(before);
      expect(store.has("tarot:profile:v1")).toBe(false);
      vi.unstubAllGlobals();
    });

    it("同一条记录已有回读：mergeRecalls 不重复", async () => {
      const store = stubStorage();
      store.set("tarot:recall:v1", JSON.stringify([recall(ID_A, "recall-local-0001")]));
      await applyImport(plan([], { recallsAdd: [recall(ID_A, "recall-file-00001")] }));
      expect(JSON.parse(store.get("tarot:recall:v1")!)).toHaveLength(1);
      vi.unstubAllGlobals();
    });
  });
});
