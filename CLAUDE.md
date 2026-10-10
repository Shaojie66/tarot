# 此刻三张牌（塔罗网页应用）

开源、本地自托管的塔罗网页：随机抽牌 + AI 辅助的结构化自我对话。定位是反思工具，不是预测工具。不做线上运营、付费、埋点。

计划与决策：`docs/PLAN.md`（改动范围前先改这里）。

## 产品红线（所有代码、文案、prompt 都适用）
- 不承诺准确、不预测具体事件，不用"一定 / 注定 / 必然"等断言（`BANNED_PHRASES`，测试覆盖）。
- 抽牌只在客户端用 `crypto.getRandomValues` 完成，模型永远不参与选牌；服务端用 `isValidDraw` 校验。
- 问题原文只存在浏览器本地和用户已选择的 AI 操作请求中，服务端不落盘、不打日志；选“全程本地”时不向模型发送任何内容。
- **分享**（分享图等）默认只含白名单字段（牌名、正逆位、位置标签、关键词、牌组署名、固定免责声明），不含问题、自解、解读正文、笔记、主题、时间、记录 id；个性化文本须逐项主动选择并预览。字段表见 `docs/PLAN.md`「导出边界」。
- **私密完整备份**是用户主动下载、用于无损恢复的文件，含问题、自解、笔记等明文，下载前提示；不含草稿、key、设备信息，文件名不含问题文字。备份与分享是两个交付，范围不互相套用。
- 危机内容（自伤等）命中后中止占卜流程，展示求助资源。
- 没有 API key 时必须仍能完整走通（离线解读）。

## 解读内容质量（2026-10-10 修订；实现以 PLAN 的 L1–L3 为准）

- 本地解读必须有明确观点、三牌之间的联系和有针对性的下一步；“不预测、不冒认事实”不等于“不分析、不建议”。允许直接说明牌义与建议优先级，不要求每句都写“可能 / 也许”。
- 选择权由可拒绝、可改写的交互保障；不把“不替你决定”“只写给自己”“不用处理”等固定短语作为质量或安全测试的必要条件。安全测试检查实际行为，语言质量另行审读。
- 保留牌面象征和画面感，结论要能追溯到这组牌；不能把未知的用户现实、他人动机或未来写成已知事实。
- 当前本地规则不理解自由文本，不能把问题 / 自解的复述宣传成个性化分析。下一轮先提高主题、意图、位置与牌义层面的具体性；不暗中调用模型。
- 标准与示范：`docs/prd-local-reading-quality-2026-10-10.md`；实施边界：`docs/review-local-reading-quality-2026-10-10.md`。本次只改规范文档，没有修改当前 v7 prompt 或本地内容 JSON。

## 公开仓库卫生
- 仓库公开：不提交密钥、个人邮箱、本机路径、本机代理等个人环境信息。
- API key 只放 `.env.local`（已 gitignore）。

## 目录约定
- `src/app` 路由；`src/features/<领域>` 业务逻辑；`src/components` 跨领域 UI 组件；`src/lib` 通用基础设施。
- `content/cards/{major,wands,cups,swords,pentacles}.json` 牌义数据，由 `src/features/cards/cards.ts` 加载并 Zod 校验。
- `content/local-reading.json`（本地解读 v1 模板，作为回退）与 `content/local-reading-v2.json`（经过编辑的牌面内容：每张牌每个朝向写好三个位置的贡献、两条核对路径、三种意图的行动、追问；三张牌都有 v2 内容才使用，否则整体回退 v1）。本地规则不读问题正文；改内容后跑 `pnpm check`，并用 `PRINT_LOCAL_SAMPLES=1 pnpm vitest run evals/print-local-samples.test.ts` 重新生成盲看样本。
- `content/questions.json` 示例问题库：只收开放式问题（"怎么 / 是什么"），不收"会不会"式预测问题。
- `content/prompts/vN/` 版本化 prompt，改 prompt 新建版本目录，不原地修改。
- `public/decks/<deck-id>/` 牌组图片（`rws-1909` 原版、`ai-v1` 等重绘），每个牌组带 `SOURCES.md`，在 `src/features/cards/deck.ts` 登记；业务代码通过 `cardImageSrc()` 取路径，不写死。只用 1909 原版公有领域扫描或基于它的重绘。
- `src/features/{history,daily,share,perspective,settings,profile,recall}` 历史回看 / 每日一张 / 分享图 / 换视角 / 本机设置；分享只能经 `share-model.ts` 的白名单重建内容，不得直接读取记录正文。
- `src/features/history` 历史与回看界面；记录读写、备份预检在 `src/features/reading/{storage,backup}.ts`。记录 schema 当前为 v2（含 `deckId`、设置快照），v1 旧记录继续可读且不批量迁移（见 `docs/decisions/002`）。
- `Dockerfile` / `docker-compose.yml`：镜像不含密钥（`.dockerignore` 排除 `.env*`、`deepseek/`、`tmp/`）；compose 只映射 127.0.0.1。PWA 的 service worker 源码在 `src/features/pwa/sw-source.ts`，**永不缓存 `/api/*`**，离线行为见 `docs/pwa-offline.md`。
- `scripts/` 数据抓取与生成脚本（可重复运行）。路径用 `fileURLToPath`，项目目录可能含非 ASCII 字符。
- `evals/` prompt 评测集，改 prompt 后必须跑一次。
- `docs/` 计划、决策记录（`docs/decisions/NNN-标题.md`）。
- 文件名 kebab-case；组件 PascalCase；临时文件放 `tmp/`（已 gitignore）。

## AI 调用
- Anthropic 的模型 ID 只写在 `src/lib/ai/models.ts`：`fast` = `claude-haiku-5-5`（改写、短解读、安全分类），`deep` = `claude-sonnet-5-5`（换视角、深度解读）。OpenAI 兼容接口（DeepSeek 等）的模型名由用户在环境变量里配（`OPENAI_MODEL` / `OPENAI_MODEL_DEEP`），代码里不写死。
- **产品要适配各种模型**：不同模型对 schema 的遵守程度不一。`src/features/reading/model-output.ts` 只做无损整理（取 JSON、丢多余字段、拉平套层数组），不合格带原因重试一次；硬约束（牌面一致、禁词、`crisis` 必须是布尔值）不为任何模型放宽。
- 业务代码只依赖 `src/lib/ai/provider.ts` 接口，不直接 import SDK。

## 技术栈与 Next 16 注意事项
Next.js 16（App Router，`src/`）+ React 19 + Tailwind 4 + TypeScript，pnpm，Vitest，Zod。
- Next 16 与训练数据有差异：写 Next 相关代码前先查 `node_modules/next/dist/docs/`（见 `AGENTS.md`）。
- 开启了 `cacheComponents`：动态路由读 `params` 要放进 `<Suspense>` 里的子组件，页面外壳保持静态（参考 `src/app/cards/[id]/page.tsx`）。
- 不用 `next/font/google`（构建时联网，自托管离线会失败），字体走 `globals.css` 里的系统字体栈。
- 牌面图已预压缩，`next/image` 一律 `unoptimized`（统一走 `CardImage` 组件）。
- 主题色在 `globals.css` 的 CSS 变量里（`bg / surface / line / ink / muted / accent`），夜间优先。

## 验证命令（改完必须跑）
- `pnpm check`：lint + typecheck（含 `next typegen`）+ 单元测试
- `pnpm build`：涉及路由、页面、配置时额外跑
- 页面改动用 dev server（`.claude/launch.json` 的 `dev`，端口 3210）在手机视口下看一遍，并查控制台报错
- `pnpm e2e`：Playwright 手机视口 E2E（无 key 路径，含 PWA 离线、无障碍回归），涉及流程页面时跑；`E2E_BASE_URL=... pnpm e2e` 可对已运行的实例（如容器）跑同一套
- `node scripts/verify-lan.mjs`（需先 build）：局域网授权矩阵；`node scripts/verify-deck.mjs`：牌组完整性
- 改 prompt：新建 `content/prompts/vN/`（当前 v7：v5 的换视角与“这次想要的帮助”，加上整句不断言处境 / 不替用户确认内心 / 行动不涉及联系他人 / 反问不以“如果”开头），跑 `pnpm test`（mock 评测）；有 key 时再跑 `pnpm eval:live`

## Design Context

### Users
成年早期、反复试错、对未来不太确定的人（"奥德赛时期"的迷茫年轻人）。典型场景：**深夜、一个人、手机上**，带着一件说不清的事。他们要完成的事：把模糊的困惑说清楚，得到几种读法和一个能马上做的小步，解释权始终在自己手里。他们此刻可能脆弱：不需要被推销、被说教、被"预测"。中文为主。

### Brand Personality
**安静 · 私密 · 诚实**。像一本深夜里自己翻开的日记本，不是占卜馆，也不是心理 App。语气平实、克制、不使劲鼓励，不夸大、不神秘化；定位是"反思工具，不是预测工具"，界面要让人感到可以放心说话、可以随时停下、可以拒绝。情绪目标：被接住、平静、有一点点往前的余地。

### Aesthetic Direction
- **方向：安静的深夜日记本。** 克制，纸张与墨的质感，大量留白，衬线标题，几乎不炫技。
- **主题：只保留夜间**（产品使用场景就是深夜独处，一个主题做到位）。现有令牌：墨底 `#15131b`、`surface #1e1b26`、`line #2f2b39`、羊皮纸色文字 `#ece4d4`、`muted #9b9184`、金色强调 `#d6a65c`；标题衬线 Songti SC / Noto Serif SC，正文系统无衬线栈；不使用 `next/font/google`（自托管离线）。
- **牌面**：1909 莱德-韦特原版扫描是画面里色彩最丰富的部分，其余界面应为它退后——牌是主角，界面是桌布。
- **明确不要的**（默认遵循 frontend-design 的反套路清单）：神秘学套路（紫色星空、水晶球、符号堆砌）、心理疗愈 App 的"温柔腔"（粉彩渐变、堆叠圆角卡片、治愈插画）、游戏化（积分、打卡）、强动效（持续漂浮、闪烁、粒子）。未被用户额外点名，其余按通用规范把关。
- 动效：只在状态变化与翻牌 / 洗牌的仪式处使用；尊重 `prefers-reduced-motion`（已有）。

### Design Principles
1. **牌是主角，界面是桌布。** 留白与低对比的层级让牌面和文字呼吸；强调色只给"下一步可以点的东西"和一两处关键位置。
2. **安静优先于惊艳。** 深夜独处时不打扰：无持续动画、无闪烁、无大面积高饱和；一次精心编排的进入（如翻牌）胜过处处微交互。
3. **像手写本，不像仪表盘。** 靠字号、字重、行距、间距的节奏建立层次，而不是把每块内容都装进带边框的卡片；左对齐、非对称版式优于居中堆叠。
4. **把选择权还给用户。** 建议与决定视觉上分开（建议是淡的、决定是实的）；"跳过 / 这次先不做 / 返回修改"与主操作同等可见，不做成灰暗的小字。
5. **可访问是底线。** 正文对比度 ≥ 4.5:1（已有测试）、触控目标 ≥ 24px 并向 44px 靠拢、焦点可见、键盘全流程可用、reduced-motion 关闭动画、读屏有名称；中文排版先看可读性（行高、行宽、字重）再看装饰。
