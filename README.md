<!-- README_SYNC: source=working-tree; updated=2026-10-24 -->
<p align="center">
  简体中文 · <a href="./README_EN.md">English</a>
</p>

<h1 align="center">此刻三张牌</h1>

<p align="center">
  抽三张牌，和自己聊一小会儿。<br />
  一个本地运行的塔罗网页，给反复试错、对未来不太确定的人。不预测，只帮你把困惑说清楚。
</p>

<p align="center">
  <a href="https://github.com/Shaojie66/tarot"><strong>⭐ 如果它对你有用，点一个 Star</strong></a>，方便以后回来，也让有同样需要的人更容易找到它。
</p>

<p align="center">
  <a href="https://github.com/Shaojie66/tarot"><img alt="Stars" src="https://img.shields.io/github/stars/Shaojie66/tarot?style=flat&color=d6a65c" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat" /></a>
  <img alt="Node.js 20+" src="https://img.shields.io/badge/node-20%2B-339933?style=flat" />
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black?style=flat" />
  <a href="https://github.com/Shaojie66/tarot/issues"><img alt="Issues" src="https://img.shields.io/github/issues/Shaojie66/tarot?style=flat" /></a>
  <a href="https://github.com/Shaojie66/tarot/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Shaojie66/tarot?style=flat" /></a>
</p>

## 它是什么

深夜、一个人、拿着手机，带着一件说不清的事。你写下问题，抽三张牌，先说说自己怎么看，再读它给的几种读法和一个能马上做的小步。最后怎么理解，由你决定。

塔罗牌在这里只是一组随机的象征符号，用来给模糊的困惑一个落脚点。它**不预测未来，不替你做决定**，定位是反思工具。

## 和别的塔罗应用不同在哪

- **没有 API key 也能完整用。** 默认的本地解读基于牌义和规则，不联网、不调用任何模型。想要 AI 解读再自己接，Anthropic 和任何 OpenAI 兼容接口（DeepSeek、通义、Kimi、本地 Ollama / vLLM 等）都行。
- **抽牌与模型无关。** 只在浏览器里用 `crypto.getRandomValues` 抽，服务端校验，模型永远不参与选牌。
- **你的问题不离开你的浏览器，除非你选了 AI。** 提交前要明确选“全程本地”或“AI 辅助”。服务端不落盘、不记录问题内容。
- **不说“一定 / 注定 / 必然”。** 牌义和 prompt 都只描述状态与张力，不描述必然结果；测试里有禁词检查。
- **识别到自伤等危机内容会停下占卜**，展示各地的求助资源，而不是继续解牌。
- **牌面是 1909 年莱德-韦特原版**（公有领域），界面退到牌后面，夜间主题。

## 快速开始

需要 Node.js 20+ 和 [pnpm](https://pnpm.io)。

```bash
git clone https://github.com/Shaojie66/tarot.git
cd tarot
pnpm install
pnpm dev
```

打开 http://localhost:3000 。不需要任何配置，就能走完整个流程：选情境或写问题 → 洗牌抽牌 → 翻牌 → 先自解 → 解读 → 小行动 → 保存记录。

### 开启 AI 解读（可选）

把 key 写进 `.env.local` 后重启：

```bash
cp .env.example .env.local
```

方式 A：Anthropic。

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

方式 B：OpenAI 兼容接口（以 DeepSeek 为例）。

```bash
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

其余可选项（`OPENAI_MODEL_DEEP`、`OPENAI_TEMPERATURE`、`OPENAI_JSON_MODE`、`AI_PROVIDER`）见 `.env.example`。

- 不同模型对输出格式的遵守程度不一。应用会丢弃多余字段、拉平套层的数组，不合格时带着原因自动重试一次；牌面对不对得上、有没有断言式用语、危机标记是否为布尔值这些硬约束不放宽，仍不合格就丢弃并提示重试或改用本地。重试会让一次解读多发一次请求。
- AI 失败（超时、断网、key 无效）时，问题和牌都保留，可以重试或改用本地，不会重抽。
- 评测：用 DeepSeek 跑固定的 40 个解读用例，两轮分别通过 97.5% 和 100%；换个视角 12/12（两轮）。Claude 模型的评测还没跑，需要自备 key。想测你选的模型，用 `pnpm eval:live`，见 [evals/README.md](evals/README.md)，会产生少量费用。

## 现在能做什么

- 78 张牌义（正逆位 × 事业 / 关系 / 自我 / 去留，附反思问题）。
- 首访可选的小问卷（可跳过、只存本地），决定解读语气和情境卡顺序；保存后 3 天 / 一周后轻轻提醒你回来看看当时的自己，不推送、可忽略。
- 历史回看（情绪标签、笔记、小行动复盘）、完整备份与导入。
- 每日一张（按当地日期，同一天固定同一张，不调用模型）。
- 换个视角：温和支持 / 理性拆解 / 挑战提问，另存一份，不改原解读。
- 分享图：本地生成，默认只含牌面、位置、关键词，问题和小行动要逐项勾选并先预览。
- PWA：可安装，访问过的页面断网可用；有 Docker 镜像。
- 求助资源：大陆、英国爱尔兰、美国、加拿大，附官方来源与核对日期。

### 已知局限

- **本地解读的个性化程度有限。** 本地规则不读问题和自解的文字，只根据主题、意图、牌义与位置组织内容。目前经过编辑打磨的新版内容只覆盖 78 张牌里的 12 张，随机抽到三张都在其中的概率约 0.3%，其余组合回退到较通用的模板。进度和流程见 [docs/local-reading-expansion/STATUS.md](docs/local-reading-expansion/STATUS.md)。想要贴合你问题的解读，请接入 AI。
- 危机识别基于规则和模型标记，对固定测试集有效，不保证覆盖所有现实表达，不能替代专业帮助。
- PWA 在电脑端实测过；iOS / Android 真机验收还没做，清单见 [docs/device-checklist.md](docs/device-checklist.md)。
- AI 重绘牌组在计划中，目前只有 1909 原版。

## 数据与隐私

- 问题、自解和记录只存在**当前浏览器**的本地存储（IndexedDB）。换浏览器、设备或端口不同步，清理浏览器数据会删掉它们，没有云端备份。
- 选“全程本地”，不向任何模型发送内容。选“AI 辅助”后，问题改写和解读会把所需内容（问题、自解、牌面）发给你配置的模型 API；重试和 SDK 自动重试可能让实际请求更多。已发出的内容无法撤回，之后改选本地只保证不再继续发送。
- 换个视角会把问题、自解、牌面和之前的读法发给模型，点哪个视角才发。
- 分享图在浏览器里生成，不上传，没有网址。
- **完整备份**含问题、自解、笔记的**明文**，是给你自己恢复用的，不要拿去分享。导入前会预检并预览；同一条记录内容不同时默认保留本机版本。设置、API key 和进行中的草稿不进备份。

## 部署

```bash
pnpm build
pnpm start
```

或用 Docker：

```bash
docker compose up --build
```

- 默认只映射到 `127.0.0.1:3000`。镜像不含密钥（`.dockerignore` 排除了 `.env*`）；要开 AI，在项目根目录建 `.env.local`，compose 在运行时读取。镜像以非 root 运行，带健康检查（`/api/status`）。
- **在手机上用：** 默认只监听本机，API 只接受 localhost 和同源请求。要让手机访问，显式开启局域网模式：

  ```bash
  pnpm build && pnpm start:lan
  ```

  手机连同一个 Wi-Fi，打开 `http://<电脑的局域网 IP>:3000`。记录保存在手机浏览器里。

  > ⚠️ 开启后，同一网络里的任何设备都能打开页面并调用你的 AI 接口，消耗额度，问题内容也会经过你的电脑发给模型。只在可信网络里用，用完关掉。`start:lan` 适用于 macOS / Linux 的 shell，Windows 请自行设置环境变量 `TAROT_ALLOW_LAN=1`。
- **离线 / 安装到主屏**需要安全上下文：`http://localhost` 或 `https://`。局域网 `http://192.168.x.x` 下页面能用，但浏览器不允许 service worker，没有离线和安装能力；要的话请自行套一层 HTTPS。第一次访问必须在线。细节见 [docs/pwa-offline.md](docs/pwa-offline.md)。

## 开发

```bash
pnpm check
pnpm build
pnpm e2e
pnpm eval:live
```

- `pnpm check`：lint + 类型检查 + 单元测试 + mock 评测。
- `pnpm build`：生产构建。
- `pnpm e2e`：Playwright 手机视口端到端测试。
- `pnpm eval:live`：真实模型评测，需要 key，会产生少量费用。

`pnpm e2e` 默认用本机 Chrome；设 `E2E_BROWSER_CHANNEL=` 改用 Playwright 自带 Chromium。

```text
src/app/            页面与 API 路由
src/features/       业务模块（cards / draw / reading / safety / history / daily / share ...）
src/lib/ai/         模型配置与 provider 接口
content/cards/      78 张牌义数据（JSON，加载时 Zod 校验）
content/prompts/    版本化 prompt（改 prompt 新建版本目录）
evals/              固定评测集
public/decks/       牌组图片，每个牌组附 SOURCES.md
docs/               计划、决策记录、质量评审
```

技术栈：Next.js 16（App Router）+ React 19 + Tailwind 4 + TypeScript，Vitest，Zod。计划和决策见 [docs/PLAN.md](docs/PLAN.md) 与 [docs/decisions/](docs/decisions/)。

### 贡献

欢迎改进文案、牌义和本地解读内容。内容原则只有一条：**描述状态与张力，不描述必然结果**。提 PR 前跑一下 `pnpm check`。有问题或想法，直接提 [Issue](https://github.com/Shaojie66/tarot/issues)。

## 牌面来源与许可

牌面使用 Pamela Colman Smith 绘制、1909 年出版的莱德-韦特塔罗原版扫描件，来自 Wikimedia Commons，属于**公有领域**，逐张来源见 [SOURCES.md](public/decks/rws-1909/SOURCES.md)。

代码与牌义文案采用 [MIT](LICENSE) 许可；牌面图片为公有领域。

## 免责声明

本项目是自我反思与娱乐工具，不提供医疗、心理、法律或财务建议。如果你正处在危机中，请联系当地的心理援助热线或紧急服务。

---

<p align="center">
  如果它解决了你的实际问题，可以 <a href="https://github.com/Shaojie66/tarot"><strong>Star</strong></a> 一下，也可以 <a href="https://github.com/Shaojie66/tarot/subscription">Watch</a> 后续更新，或者提一个 <a href="https://github.com/Shaojie66/tarot/issues">Issue</a>。
</p>
