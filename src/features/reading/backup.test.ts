import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_VERSION, MAX_BACKUP_BYTES, backupFileName, buildBackup, parseBackup, recordsToWrite, stableStringify } from "./backup";
import { CONTENT_VERSION, RECORD_SCHEMA_VERSION, type ReadingRecord, type Review } from "./contract";
import { buildLocalReading } from "./local";
import { clearEverything, deleteRecord, getRecord, listRecords, saveFlowRecord, saveRecord, updateReview, writeImported } from "./storage";

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
    expect(Object.keys(backup).sort()).toEqual(["backupVersion", "contentVersion", "exportedAt", "format", "records"]);
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
