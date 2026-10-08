# 塔罗网页应用

面向迷茫年轻人的移动优先塔罗网页：随机抽牌 + AI 辅助的结构化自我对话。定位是反思工具，不是预测工具。

计划与决策：`docs/PLAN.md`（改动范围前先改这里）。

## 产品红线（所有代码、文案、prompt 都适用）
- 不承诺准确、不预测具体事件，不用"一定 / 注定 / 必然"等断言。
- 抽牌只在客户端用 `crypto.getRandomValues` 完成，模型永远不参与选牌；服务端校验牌 ID。
- 问题原文不进服务端数据库、日志、埋点；埋点只记主题类别和漏斗事件。
- 分享内容默认不含问题原文。
- 危机内容（自伤等）命中后中止占卜流程，展示求助资源。

## 目录约定
- `src/app` 路由；`src/features/<领域>` 业务逻辑与组件；`src/lib` 通用基础设施。
- `content/cards/*.json` 牌义数据，`content/prompts/vN/` 版本化 prompt，改 prompt 必须新建版本目录，不原地修改。
- `public/decks/<deck-id>/` 牌面图，按牌组分目录（`rws-1909` 原版、`ai-v1` 等 AI 重绘），每个牌组带 `SOURCES.md`；当前牌组由配置切换，业务代码不写死路径。只用 1909 原版 RWS 公有领域扫描或基于它的重绘，不用任何后期商业重绘版。
- `evals/` prompt 评测集，改 prompt 后必须跑一次。
- `docs/` 计划、决策记录（`docs/decisions/NNN-标题.md`）、研究资料。
- 文件名 kebab-case；组件 PascalCase；临时文件放 `tmp/`（已 gitignore），用完即删。

## AI 调用
- 模型 ID 只写在 `src/lib/ai/models.ts` 一处。
- 默认：`claude-haiku-5-5`（问题改写、免费解读、安全分类），`claude-sonnet-5-5`（换视角、深度解读）。
- 通过 provider 接口调用，不在业务代码里直接 import SDK，便于以后切换模型供应商。
- API key 只放 `.env.local`，不进代码和 commit。

## 技术栈
Next.js 16（App Router，`src/` 目录）+ React 19 + Tailwind 4 + TypeScript，pnpm，Vitest。
Next 16 与训练数据有差异：写 Next 相关代码前先查 `node_modules/next/dist/docs/`（见 `AGENTS.md`）。

## 验证命令（改完必须跑）
- `pnpm check`：lint + typecheck（含 `next typegen` 生成路由类型）+ 单元测试
- `pnpm build`：涉及路由、页面、配置时额外跑
- `pnpm e2e`：M2 引入 Playwright 后补

## 本机环境注意
`~/.npmrc` 配了代理 `127.0.0.1:7890`。代理没开时安装依赖会 `ECONNREFUSED`，用 `NPM_CONFIG_USERCONFIG=<空文件> pnpm install` 临时绕过，不要改全局配置。
