# 历史方案 · 小行动跟进 + 回望页

> **已退出执行队列（2026-10-10）**：提醒方向已被 `recall` 实现取代。当前执行依据是 [PLAN v1.3](PLAN.md) 与 [可控回读与可信数据 PRD](prd-recall-reliability-2026-10-10.md)。下文保留原始讨论，不作为开发任务。
>
> 明确撤回原稿中的“新增 followups 存储”“超限丢弃最旧 pending”“提醒不进入备份”；当前回读已进入备份，不得再建一套提醒，也不得静默清理。回望统计页暂缓。“填写率必然极低”“只读零风险”及竞品有效性等缺少验证的表述仅是当时假设，不是已证实结论。

- 日期：2026-10-09
- 状态：**历史提案，已被后续 PRD 替代**
- 输入：1.0 版本三角度检查（2026-10-09），P0 迭代方向：把"单次占卜工具"补成定位承诺的"日记本"

## 问题（为什么做）

当前用户旅程前 4 步（说清困惑 → 获得角度 → 得到小行动 → 保存）闭环扎实，但 5–7 步空白：

| 阶段 | 现状 | 后果 |
|---|---|---|
| 5. 24 小时内真的去做那个小行动 | 选了"就做这个"即结束，无提醒、无触点 | "24 小时内可以试的一小步"是一句没人兑现的承诺 |
| 6. 回来勾一下：做没做、困惑还在吗 | 全靠用户主动想起，去历史页手动填 | 行动复盘的填写率必然极低 |
| 7. 长期：我是不是在重复同一个困惑 | 空白。但主题、情绪标签、行动复盘、正逆位、牌面、时间**全已存储** | 收集了自我洞察的原料，零呈现 |

**判断**：让产品成为"日记本"的最小动作，是把 5/6 接上（跟进），再把已存数据变成可见的回望（7）。两者都不引入新的数据收集，只增加触发与呈现。

## 设计原则（沿用项目红线）

- **纯本地**：所有跟进与回望数据只在本设备站点，不上传、不进 API。不新增任何向模型发送的内容。
- **不新增 IndexedDB 表**：沿用决策 003 先例，跟进提醒用 localStorage；回望页只读既有 IndexedDB `records`。
- **隐私与现有边界一致**：跟进不进入分享图（分享仍走白名单）；设置不随备份导入的约定不变。
- **可选、可拒绝**：跟进提醒默认关闭（用户勾选才设）；回望页是只读视图，不改变任何记录。
- **不侵入核心流程**：方案只新增两个入口 + 一个提醒机制，不改动现有抽牌/解读/历史逻辑。

## 一、小行动跟进（把第 5、6 步接上）

### 现状盘点

- 已有：`choice.action`（当时是否接受建议）、`review.followUp`（用户手动填的"后来做了吗"，含 `status/note/at`）。
- 缺：没有触发机制，用户不会记得回来。

### 交互设计

**① 结果页 —— 小行动确定后，可选设置跟进**

在小行动区（"就做这个 / 改成我的版本 / 这次先不做"）下方，新增一个可折叠、默认收起的小块：

> 需要我过几天回来问一句"做到了吗"吗？
> [3 天后] [7 天后] [不用了]

- 只在 `choice.action.status` 为 `accepted` 或 `edited`（即用户明确决定做）时显示。
- 选了时间即创建一条跟进提醒；"不用了"或无操作则不设。
- 文案坚持"问一句、提醒你"的口吻，不催、不评判，符合"把选择权还给你"。

**② 首页 / 历史 —— 到期提醒**

- 首页：`/` 底部出现一条轻量提示（非弹窗、可关闭）：
  > 你 3 天前说"每天散步 20 分钟"。做到了吗？[去勾一下] [先不管]
- 历史页：到期但未处理的跟进，在列表项上显示角标"待回看"。

**③ 历史详情 —— 一键进入复盘**

点击"去勾一下"→ 直接跳转到该记录的 `HistoryDetail`，并滚动到"回看"区、聚焦"后来做了吗"。复用现有 `review.followUp` 填写，**不新增复盘字段**。

**④ 跟进闭环**

用户勾了"做了/没做/做了一半"→ 该跟进标记为已处理（`done`），不再提醒。用户也可以在任何时候手动标"不再提醒"（`dismissed`）。

### 数据模型（新增 localStorage key）

`tarot:followups:v1`，纯本地，参考决策 003 的 localStorage 模式：

```ts
const followupSchema = z.strictObject({
  id: z.string().min(8),               // randomId()
  recordId: z.string().min(8),         // 对应 ReadingRecord.id
  actionText: z.string().max(200),     // 快照当时的小行动文字（分享/删除不受影响）
  dueAt: z.iso.datetime(),             // 提醒到期时间
  status: z.enum(["pending", "done", "dismissed"]),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable().optional(),
});
```

规则（沿用项目"简单、确定、不猜测"风格）：

- 最多保留最近 200 条（防无限增长），超出丢弃最旧的 `pending`。
- 到期的判定在客户端用本地时钟；`pending` 且 `dueAt <= now` 即进入提醒池。
- **跟进不写入记录本身**，避免 IndexedDB schema 变更；也不进备份（它只是提醒，记录本身已含复盘）。
- **删除记录时**：级联删除指向该 `recordId` 的跟进（在现有 `deleteRecord` 里补一行）。
- **清空全部时**：清空跟进（在现有 `clearEverything` 里补一行）。

### 落地改动（估算）

| 文件 | 改动 |
|---|---|
| `src/features/followup/followup.ts`（新） | schema、`load/store/add/markDone/dismiss/expired` 纯函数 |
| `src/features/reading/components/ResultView.tsx` | 小行动区下加跟进设置块（默认收起） |
| `src/app/page.tsx` | 首页到期提醒条 |
| `src/features/history/components/HistoryList.tsx` | 列表"待回看"角标 |
| `src/features/history/components/HistoryDetail.tsx` | 接受 `?focus=review` 参数 → 滚动聚焦复盘 |
| `src/features/reading/storage.ts` | `deleteRecord`/`clearEverything` 级联清理跟进 |
| `src/features/followup/followup.test.ts`（新） | 纯函数单测 |

## 二、回望页（把第 7 步补上）

### 现状盘点

`records`（IndexedDB）已含：主题 `topic`、情绪标签 `review.moods`、行动复盘 `review.followUp`、行动决定 `choice.action`、牌面 `cards`、时间 `createdAt`、来源。**全部被收集，从未聚合呈现。**

### 交互设计

**新增 `/insight` 回望页**（可从历史页顶部入口进入）：

1. **时间范围切换**：全部 / 近 30 天 / 近 90 天。
2. **主题分布**："你最近反复在哪些主题上困惑？" —— 按 `topic` 分组的记录数柱状/条形（事业 / 关系 / 自我 / 去留）。
3. **情绪标签分布**："回头看，这些时刻的心情" —— 按 `review.moods` 聚合的频次（平静 / 期待 / …）。
4. **行动完成率**："你说要做的那些小行动，后来做了多少？" —— 基于 `review.followUp.status` 的 `done / partial / not_done / dropped / 未回看` 占比。**未回看（没填 followUp）单独列为一档**，诚实呈现"还没回来记录"。
5. **重复困惑提示**："你有 X 次'去留'主题的记录，最早与最近相隔 N 天。" —— 纯计数 + 时间跨度，不生成任何解读。
6. **（可选，P1）线索 Thread**：同一主题的连续记录从时间轴串联，本文案只作为回望页的延伸预留，不并入本次 P0。

### 数据模型

**只读，不新增存储、不新增字段**。回望页从现有 `listRecords()`（IndexedDB）在客户端聚合。新增一个纯函数模块：

```ts
// src/features/insight/insight.ts（新，纯函数，可测）
interface InsightInput { records: ReadingRecord[] }
interface TopicCount { topic: Topic; count: number }
interface MoodCount { mood: (typeof MOODS)[number]; count: number }
interface ActionOutcome { done: number; partial: number; not_done: number; dropped: number; unreviewed: number }
```

聚合逻辑全部可单测，不依赖任何服务端。

### 落地改动（估算）

| 文件 | 改动 |
|---|---|
| `src/features/insight/insight.ts`（新） | 聚合纯函数（主题/情绪/行动） |
| `src/app/insight/page.tsx`（新） | 回望页（读 `listRecords`，客户端渲染） |
| `src/features/insight/InsightView.tsx`（新） | 视图组件 |
| `src/app/layout.tsx` | 导航加"回望"入口（或历史页顶部入口） |
| `src/features/insight/insight.test.ts`（新） | 聚合单测 |
| `e2e/insight.spec.ts`（新） | 空态 / 有数据态 / 时间过滤 e2e |

## 优先级与顺序

1. **先做小行动跟进**（改动小、直接兑现"24 小时一小步"承诺、把 5/6 接上）。
2. **再做回望页**（只读、零风险、把已存数据变成价值）。

## 风险与验证

| 风险 | 缓解 |
|---|---|
| 跟进提醒打扰用户、违背"安静" | 默认关闭、可选设置、非弹窗、可"先不管"；克制文案；尊重 `prefers-reduced-motion` |
| 提醒被系统清理（localStorage 非持久） | 定位为"本机轻提醒"，不承诺可靠送达；记录本身才是真相，跟进只是钩子 |
| 回望页可能引向"自我归因/预测" | 只做计数与时间跨度呈现，**不生成任何解读、不下结论**；文案强调"这是记录，不是答案" |
| 聚合性能 | 个人单实例、记录量有限，客户端聚合足够；必要时按时间过滤后再聚合 |

**验证命令**（沿用项目规范）：

- `pnpm check`：新增纯函数单测 + 类型检查全绿。
- `pnpm build`：新增 `/insight` 路由构建通过。
- `pnpm e2e`：跟进提醒（设置→到期→首页提示→去勾→不再提醒）与回望页（空态/有数据/过滤）新增用例。
- 页面改动用 dev server 在手机视口看一遍，查控制台报错。

## 不做（明确边界）

- **不做云端同步 / 端到端加密备份**：违背"本地优先"，超出本次 P0。
- **不做跟进的真实系统通知（Web Push）**：需要服务端与权限，成本高、超出"轻量提醒"定位；本次仅站内提示。
- **不改动现有记录 schema / 不做线索 Thread 主体**：Thread 作为 P1 独立方案，本文只预留方向。

## 验收口径

"小行动跟进 + 回望页"完成 = 用户能从结果页为一个已决定的小行动设置跟进，到期后在首页收到提示、可一键回到该记录复盘，复盘后可停止提醒；且能在一个只读页面看到自己近期的主题、情绪与行动完成情况——全程本地、不新增向模型的发送、不新增 IndexedDB 表、不改变任何既有记录。
