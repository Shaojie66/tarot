# 此刻三张牌

> 有点迷茫？抽三张牌，和自己聊两分钟。

一个可以本地运行的塔罗网页应用，写给在成年早期反复试错、对未来不太确定的人。

它**不预测未来**。塔罗牌在这里是一组随机的象征符号，用来帮你把模糊的困惑说清楚：此刻卡在哪里、可以试的下一步是什么。解读给出几种读法和一个反问，最后怎么理解由你自己决定。

## 现状

| 功能 | 状态 |
|---|---|
| 78 张牌义百科（正逆位 × 事业 / 关系 / 自我 / 去留 + 反思问题） | ✅ |
| 1909 年原版莱德-韦特牌面 | ✅ |
| 起问 → 洗牌抽牌 → 翻牌 → AI 解读（流式） | 开发中 |
| 无 API key 的离线解读模式 | 开发中 |
| 历史记录、回看笔记、每日一张、导出图片 | 计划中 |
| AI 重绘牌组 | 计划中 |

完整计划见 [docs/PLAN.md](docs/PLAN.md)。

## 本地运行

需要 Node.js 20+ 和 [pnpm](https://pnpm.io)。

```bash
git clone https://github.com/Shaojie66/tarot.git
cd tarot
pnpm install
pnpm dev
```

打开 http://localhost:3000 。

### 开启 AI 解读（可选）

AI 解读功能需要你自己的 [Anthropic API key](https://console.anthropic.com/)。不填也能用，会走离线解读。

```bash
cp .env.example .env.local
# 编辑 .env.local，填入 ANTHROPIC_API_KEY
```

问题内容只保存在你的浏览器里，发给模型 API 的只有单次解读请求本身，服务端不落盘。

### 生产模式

```bash
pnpm build
pnpm start
```

## 开发

```bash
pnpm check   # lint + 类型检查 + 单元测试
pnpm build   # 生产构建
```

```
src/app/            页面与 API 路由
src/features/       业务模块：cards（牌义）/ draw（抽牌）/ reading（解读）
src/lib/ai/         模型配置与 provider 接口
content/cards/      78 张牌义数据（JSON，加载时 Zod 校验）
content/questions.json  示例问题库
public/decks/       牌组图片，每个牌组附 SOURCES.md
scripts/            数据抓取脚本
```

### 内容原则

牌义和 AI 解读遵循同一条规则：**描述状态与张力，不描述必然结果**。测试会检查牌义里不出现“一定 / 注定 / 必然”等断言式用语。欢迎改进文案，提 PR 前跑一下 `pnpm check`。

## 牌面来源

`public/decks/rws-1909/` 使用 Pamela Colman Smith 绘制、1909 年出版的莱德-韦特塔罗原版扫描件，来自 Wikimedia Commons，属于**公有领域**。逐张来源见 [SOURCES.md](public/decks/rws-1909/SOURCES.md)。重新抓取：`node scripts/fetch-rws-deck.mjs`（需要 `cwebp`）。

## 免责声明

本项目是自我反思与娱乐工具，不提供医疗、心理、法律或财务建议。如果你正处在危机中，请联系当地的心理援助热线或紧急服务。

## 许可

代码与牌义文案：[MIT](LICENSE)。牌面图片：公有领域。
