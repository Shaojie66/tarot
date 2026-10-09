# 此刻三张牌（塔罗网页应用）

开源、本地自托管的塔罗网页：随机抽牌 + AI 辅助的结构化自我对话。定位是反思工具，不是预测工具。不做线上运营、付费、埋点。

计划与决策：`docs/PLAN.md`（改动范围前先改这里）。

## 产品红线（所有代码、文案、prompt 都适用）
- 不承诺准确、不预测具体事件，不用"一定 / 注定 / 必然"等断言（`BANNED_PHRASES`，测试覆盖）。
- 抽牌只在客户端用 `crypto.getRandomValues` 完成，模型永远不参与选牌；服务端用 `isValidDraw` 校验。
- 问题原文只存在浏览器本地和单次模型请求中，服务端不落盘、不打日志。
- 导出 / 分享的内容默认不含问题原文。
- 危机内容（自伤等）命中后中止占卜流程，展示求助资源。
- 没有 API key 时必须仍能完整走通（离线解读）。

## 公开仓库卫生
- 仓库公开：不提交密钥、个人邮箱、本机路径、本机代理等个人环境信息。
- API key 只放 `.env.local`（已 gitignore）。

## 目录约定
- `src/app` 路由；`src/features/<领域>` 业务逻辑；`src/components` 跨领域 UI 组件；`src/lib` 通用基础设施。
- `content/cards/{major,wands,cups,swords,pentacles}.json` 牌义数据，由 `src/features/cards/cards.ts` 加载并 Zod 校验。
- `content/questions.json` 示例问题库：只收开放式问题（"怎么 / 是什么"），不收"会不会"式预测问题。
- `content/prompts/vN/` 版本化 prompt，改 prompt 新建版本目录，不原地修改。
- `public/decks/<deck-id>/` 牌组图片（`rws-1909` 原版、`ai-v1` 等重绘），每个牌组带 `SOURCES.md`，在 `src/features/cards/deck.ts` 登记；业务代码通过 `cardImageSrc()` 取路径，不写死。只用 1909 原版公有领域扫描或基于它的重绘。
- `scripts/` 数据抓取与生成脚本（可重复运行）。路径用 `fileURLToPath`，项目目录可能含非 ASCII 字符。
- `evals/` prompt 评测集，改 prompt 后必须跑一次。
- `docs/` 计划、决策记录（`docs/decisions/NNN-标题.md`）。
- 文件名 kebab-case；组件 PascalCase；临时文件放 `tmp/`（已 gitignore）。

## AI 调用
- 模型 ID 只写在 `src/lib/ai/models.ts`：`fast` = `claude-haiku-5-5`（改写、短解读、安全分类），`deep` = `claude-sonnet-5-5`（换视角、深度解读）。
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
- `pnpm e2e`：M2 引入 Playwright 后补
