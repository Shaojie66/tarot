// 校验线上牌组目录是否完整：node scripts/verify-deck.mjs [deck-id]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyDeck } from "./lib/deck-staging.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const deck = process.argv[2] ?? "rws-1909";
// card id 以内容目录为准（content/cards/*.json 里的 id）
const ids = ["major", "wands", "cups", "swords", "pentacles"].flatMap((f) => JSON.parse(readFileSync(`${ROOT}content/cards/${f}.json`, "utf8")).map((c) => c.id));
const problems = verifyDeck(`${ROOT}public/decks/${deck}`, ids);
console.log(problems.length ? problems.join("\n") : `ok: ${ids.length} 张`);
process.exitCode = problems.length ? 1 : 0;
