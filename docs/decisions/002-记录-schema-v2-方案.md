# 002 · 记录 schema v2 方案（待确认，未实施）

- 日期：2026-10-09
- 状态：**提案**。涉及存储结构变更，按项目红线需用户确认后才实施。
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

## 需要你确认

- [ ] 是否同意以上 v2 字段与“不批量迁移、v1 按缺省牌组显示”的兼容策略？
- [ ] 同意后实施范围：契约 + 保存时写入 + 渲染按快照取图 + 对应测试；不触碰已有记录数据。
