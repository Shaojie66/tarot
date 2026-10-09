# 002 · 记录 schema v2 方案（待确认，未实施）

- 日期：2026-10-09
- 状态：**已采纳并实施**（2026-10-09 用户确认）。
- 输入：`docs/m2-review-2026-10-09.md` R15、PLAN C4

## 问题

记录（IndexedDB `records`）没有保存当时用的牌组 `deckId` 和正逆位开关。M3b 允许切换牌组后，旧历史会改用新牌组的图片渲染，违反“历史是保存时快照”。

## 本次已做的（不涉及迁移）

- `choice.action.status` 增加 `undecided`。只放宽校验：旧记录全部仍然合法，IndexedDB 的存储结构（表与索引）没有变，不需要 Dexie 版本升级，也不改动任何已有记录。
- 草稿（localStorage）单独版本化为 `tarot:session:v2`；旧 `v1` 草稿读到时迁移并删除旧键。草稿是临时数据，不属于记录 schema。

## 提案：`RECORD_SCHEMA_VERSION = 2`

新增两个字段（记录 `request` 同级）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `deckId` | string | 生成该记录时使用的牌组（`src/features/cards/deck.ts` 登记的 id） |
| `settings` | `{ allowReversed: boolean }` | 抽牌当时的正逆位开关快照 |

兼容规则：

1. **不改表与索引**。`records: "id, createdAt"` 保持，Dexie 不需要 `version(2)`；新字段只是对象里的属性。
2. **读**：`readingRecordSchema` 同时接受 v1 与 v2（`schemaVersion` 为 1 或 2 的联合）。
3. **v1 旧记录不伪造字段**：读出时保持缺省，渲染层用 `record.deckId ?? DEFAULT_DECK_ID`，并在 UI 标注“旧记录，按默认牌组显示”这类可识别状态。不做批量回写迁移。
4. **写**：新记录一律写 v2。已有记录被用户再次编辑（改选择）时保持其原 `schemaVersion`，不升级。
5. **导入 / 备份（M3a）**：文件里带版本号；未来版本明确拒绝；v1/v2 都可导入。

## 实施结果

- 契约：`readingRecordSchema` 是 v1 / v2 的 discriminated union；新记录写 v2（`deckId`、`settings.allowReversed`）。IndexedDB 表与索引未变，没有 Dexie 版本升级，没有改写任何已有记录。
- v1 旧记录：读出时不伪造字段；历史详情用 `recordDeck()` 取默认牌组并标注“较早版本保存的记录”。
- 占卜流程保存（`saveFlowRecord`）：记录一旦存在，只更新 `choice`；`schemaVersion`、牌组、`review` 等以已存的为准，所以流程里过期的内存状态不会抹掉历史里补写的笔记，也不会把 v1 悄悄升成 v2。有 e2e 与单测覆盖。
- 附带（M3a）：两个版本都允许可选的 `review`（情绪标签、回看笔记、行动复盘）。它是“可选字段缺省 = 用户没写”，不需要迁移；与 `choice`（当时的决定）分开存放。
- 备份：独立的 `backupVersion`（当前 1），与记录 schema 版本无关；更高版本明确拒绝。
