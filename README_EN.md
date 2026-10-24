<!-- README_SYNC: source=working-tree; updated=2026-10-24 -->
<p align="center">
  <a href="./README.md">简体中文</a> · English
</p>

<h1 align="center">Three Cards, Right Now (此刻三张牌)</h1>

<p align="center">
  Draw three tarot cards and talk it through with yourself.<br />
  A self-hosted tarot web app for people who are unsure about what comes next. It doesn't predict anything. It helps you put a vague worry into words.
</p>

<p align="center">
  <a href="https://github.com/Shaojie66/tarot"><strong>⭐ Star it if it's useful to you</strong></a>, so you can find it again and others with the same need can too.
</p>

<p align="center">
  <a href="https://github.com/Shaojie66/tarot/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Shaojie66/tarot?style=flat&color=d6a65c" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat" /></a>
  <img alt="Node.js 20+" src="https://img.shields.io/badge/node-20%2B-339933?style=flat" />
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black?style=flat" />
  <a href="https://github.com/Shaojie66/tarot/issues"><img alt="Issues" src="https://img.shields.io/github/issues/Shaojie66/tarot?style=flat" /></a>
  <a href="https://github.com/Shaojie66/tarot/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Shaojie66/tarot?style=flat" /></a>
</p>

> The app UI and card content are in Chinese. This README is for developers who want to run, read or contribute to it.

## What it is

Late at night, alone, on your phone, with something you can't quite name. You write the question, draw three cards, say how you read them first, then see a few possible readings and one small step you can take right away. How to interpret it is up to you.

Here the cards are just a set of random symbols that give a vague worry somewhere to land. The app **doesn't predict the future and doesn't make decisions for you**. It's a reflection tool.

## What's different

- **Fully usable without an API key.** The default local reading is built from card meanings and rules. No network, no model calls. If you want AI readings, bring your own: Anthropic or any OpenAI-compatible endpoint (DeepSeek, Qwen, Kimi, local Ollama / vLLM, etc.).
- **Drawing never involves a model.** Cards are drawn in the browser with `crypto.getRandomValues` and validated on the server. A model never picks a card.
- **Your question stays in your browser unless you choose AI.** Before submitting you explicitly pick "local only" or "AI-assisted". The server doesn't write questions to disk or log them.
- **No "definitely / destined / inevitably".** Card meanings and prompts describe states and tensions, never certain outcomes. Tests check for banned phrases.
- **Crisis content (e.g. self-harm) stops the reading** and shows regional help resources instead of continuing.
- **The 1909 Rider-Waite deck** (public domain) with a night theme where the UI steps back behind the cards.

## Quick start

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/Shaojie66/tarot.git
cd tarot
pnpm install
pnpm dev
```

Open http://localhost:3000. No configuration needed to go through the whole flow: pick a scenario or write a question → shuffle and draw → flip → your own take first → reading → small action → save the record.

### Enable AI readings (optional)

Put a key in `.env.local` and restart:

```bash
cp .env.example .env.local
```

Option A: Anthropic.

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Option B: an OpenAI-compatible endpoint (DeepSeek as an example).

```bash
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

More optional settings (`OPENAI_MODEL_DEEP`, `OPENAI_TEMPERATURE`, `OPENAI_JSON_MODE`, `AI_PROVIDER`) are in `.env.example`.

- Models follow output formats to different degrees. The app drops extra fields, flattens nested arrays, and retries once with the failure reason when output is invalid. Hard constraints are never relaxed: the reading must match the drawn cards, contain no assertive phrasing, and the crisis flag must be a boolean. If it still fails, the output is discarded and you can retry or switch to local. A retry means one extra request per reading.
- If AI fails (timeout, offline, bad key), your question and cards are kept. You can retry or switch to local without redrawing.
- Evals: on DeepSeek, the fixed 40-case reading set passed 97.5% and 100% in two runs; "another perspective" passed 12/12 in both runs. Claude models haven't been evaluated yet and need your own key. To test the model you choose, run `pnpm eval:live` (see [evals/README.md](evals/README.md)); it costs a small amount.

## What it does today

- 78 card meanings (upright and reversed × career / relationships / self / stay-or-leave, with reflection questions).
- An optional first-visit questionnaire (skippable, local only) that sets the reading tone and the order of scenario cards. After saving, a gentle nudge 3 days or a week later to revisit your past self. No push notifications; ignorable.
- History (mood tags, notes, small-action review), full backup and import.
- Daily card (by local date, the same card all day, no model call).
- Another perspective: gentle support / rational breakdown / challenging questions, saved separately without changing the original reading.
- Share image: generated locally. By default only the cards, positions and keywords. The question and small action need to be ticked one by one, with a preview.
- PWA: installable, visited pages work offline. A Docker image is provided.
- Help resources for mainland China, UK & Ireland, US and Canada, with official sources and check dates.

### Known limitations

- **Local readings are only lightly personalised.** The local rules don't read the text of your question or your own take. They use theme, intent, card meaning and position. The newer hand-edited content covers only 12 of the 78 cards, so the chance that a random three-card draw is fully covered is about 0.3%; other draws fall back to a more generic template. Progress and process: [docs/local-reading-expansion/STATUS.md](docs/local-reading-expansion/STATUS.md). For readings that fit your question, use AI.
- Crisis detection is rule- and model-flag based. It works on the fixed test set, doesn't cover every real-world phrasing, and is no substitute for professional help.
- The PWA has been tested on desktop. iOS / Android device acceptance isn't done yet; see [docs/device-checklist.md](docs/device-checklist.md).
- An AI-redrawn deck is planned. Only the 1909 original exists today.

## Data and privacy

- Questions, your own takes and records live only in **this browser's** local storage (IndexedDB). They don't sync across browsers, devices or ports; clearing browser data deletes them. There is no cloud backup.
- With "local only", nothing is sent to any model. With "AI-assisted", question rewriting and the reading send what they need (question, your take, cards) to the model API you configured. Retries and SDK auto-retries can mean more requests. Content already sent can't be recalled; switching to local afterwards only stops further sending.
- "Another perspective" sends the question, your take, the cards and earlier readings to the model, only when you pick a perspective.
- Share images are generated in the browser, never uploaded, and carry no URL.
- **Full backup** contains your question, takes and notes in **plain text**. It's for restoring your own data, not for sharing. Imports are pre-checked and previewed; when the same record differs, the local version is kept by default. Settings, API keys and drafts in progress are not included.

## Deployment

```bash
pnpm build
pnpm start
```

Or with Docker:

```bash
docker compose up --build
```

- Bound to `127.0.0.1:3000` by default. The image contains no secrets (`.dockerignore` excludes `.env*`); to enable AI, create `.env.local` in the project root and compose reads it at runtime. The container runs as non-root with a health check (`/api/status`).
- **Using it on your phone:** by default the server listens on localhost only, and the API accepts only localhost and same-origin requests. To reach it from a phone, explicitly enable LAN mode:

  ```bash
  pnpm build && pnpm start:lan
  ```

  Connect the phone to the same Wi-Fi and open `http://<your computer's LAN IP>:3000`. Records are stored in the phone's browser.

  > ⚠️ Once enabled, any device on the same network can open the page and call your AI endpoint, spending your quota, and questions pass through your computer to the model. Use it only on a trusted network and turn it off afterwards. `start:lan` works in macOS / Linux shells; on Windows set the environment variable `TAROT_ALLOW_LAN=1` yourself.
- **Offline / add to home screen** needs a secure context: `http://localhost` or `https://`. On a LAN `http://192.168.x.x` address the pages work, but browsers don't allow service workers, so there's no offline or install; put HTTPS in front yourself if you need it. The first visit must be online. Details: [docs/pwa-offline.md](docs/pwa-offline.md).

## Development

```bash
pnpm check
pnpm build
pnpm e2e
pnpm eval:live
```

- `pnpm check`: lint + typecheck + unit tests + mock evals.
- `pnpm build`: production build.
- `pnpm e2e`: Playwright mobile-viewport end-to-end tests.
- `pnpm eval:live`: real-model evals; needs a key and costs a small amount.

`pnpm e2e` uses your local Chrome by default; set `E2E_BROWSER_CHANNEL=` to use Playwright's bundled Chromium.

```text
src/app/            pages and API routes
src/features/       domain modules (cards / draw / reading / safety / history / daily / share ...)
src/lib/ai/         model config and provider interface
content/cards/      78 card meanings (JSON, validated with Zod on load)
content/prompts/    versioned prompts (create a new version directory to change one)
evals/              fixed eval sets
public/decks/       deck images, each with a SOURCES.md
docs/               plan, decision records, quality reviews
```

Stack: Next.js 16 (App Router) + React 19 + Tailwind 4 + TypeScript, Vitest, Zod. Plan and decisions: [docs/PLAN.md](docs/PLAN.md) and [docs/decisions/](docs/decisions/) (written in Chinese).

### Contributing

Improvements to wording, card meanings and local-reading content are welcome. The one content rule: **describe states and tensions, never certain outcomes**. Run `pnpm check` before opening a PR. For questions or ideas, open an [Issue](https://github.com/Shaojie66/tarot/issues).

## Deck source and license

The card images are scans of the original 1909 Rider-Waite tarot illustrated by Pamela Colman Smith, from Wikimedia Commons, in the **public domain**. Per-card sources: [SOURCES.md](public/decks/rws-1909/SOURCES.md).

Code and card-meaning text are under the [MIT](LICENSE) license; card images are public domain.

## Disclaimer

This is a self-reflection and entertainment tool. It does not provide medical, psychological, legal or financial advice. If you are in crisis, contact your local mental-health hotline or emergency services.

---

<p align="center">
  If it solved a real problem for you, you can <a href="https://github.com/Shaojie66/tarot"><strong>Star</strong></a> it, <a href="https://github.com/Shaojie66/tarot/subscription">Watch</a> for updates, or open an <a href="https://github.com/Shaojie66/tarot/issues">Issue</a>.
</p>
