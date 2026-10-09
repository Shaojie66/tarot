// 从 Wikimedia Commons 拉取 1909 RWS（Pamela Colman Smith）公有领域扫描件，
// 转 WebP 存到 public/decks/rws-1909/<card-id>.webp，并生成 SOURCES.md。
// 用法：node scripts/fetch-rws-deck.mjs   （需要本机有 cwebp）
// 安全更新：先全部抓到暂存目录 tmp/rws-staging，78 张全部校验通过才替换线上目录；
// 任何一张失败，public/decks/rws-1909 和 SOURCES.md 都保持上一版完整不动。上一版会备份到 tmp/rws-backup/。

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { clearDir, promoteStaged, verifyDeck } from "./lib/deck-staging.mjs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RAW_DIR = join(ROOT, "tmp/rws-raw");
const LIVE_DIR = join(ROOT, "public/decks/rws-1909");
const STAGING_DIR = join(ROOT, "tmp/rws-staging/rws-1909");
const BACKUP_DIR = join(ROOT, "tmp/rws-backup");
// 之后的写入都先进暂存目录
const OUT_DIR = STAGING_DIR;
const WIDTH = 600;
const UA = "tarot-reflection-app/0.1 (https://github.com/Shaojie66/tarot)";

const MAJOR = [
  ["the-fool", "00 Fool"],
  ["the-magician", "01 Magician"],
  ["the-high-priestess", "02 High Priestess"],
  ["the-empress", "03 Empress"],
  ["the-emperor", "04 Emperor"],
  ["the-hierophant", "05 Hierophant"],
  ["the-lovers", "06 Lovers"],
  ["the-chariot", "07 Chariot"],
  ["strength", "08 Strength"],
  ["the-hermit", "09 Hermit"],
  ["wheel-of-fortune", "10 Wheel of Fortune"],
  ["justice", "11 Justice"],
  ["the-hanged-man", "12 Hanged Man"],
  ["death", "13 Death"],
  ["temperance", "14 Temperance"],
  ["the-devil", "15 Devil"],
  ["the-tower", "16 Tower"],
  ["the-star", "17 Star"],
  ["the-moon", "18 Moon"],
  ["the-sun", "19 Sun"],
  ["judgement", "20 Judgement"],
  ["the-world", "21 World"],
].map(([id, name]) => [id, `File:RWS Tarot ${name}.jpg`]);

const RANKS = ["ace", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "page", "knight", "queen", "king"];
const SUIT_FILES = { wands: "Wands", cups: "Cups", swords: "Swords", pentacles: "Pents" };
const MINOR = Object.entries(SUIT_FILES).flatMap(([suit, prefix]) =>
  RANKS.map((rank, i) => [`${rank}-of-${suit}`, `File:${prefix}${String(i + 1).padStart(2, "0")}.jpg`]),
);

const CARDS = [...MAJOR, ...MINOR];

async function queryInfo(titles) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(WIDTH),
    titles: titles.join("|"),
  }).toString();
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  const data = await res.json();
  // API 会规范化标题（例如下划线），建立映射回原标题
  const normalized = new Map((data.query.normalized ?? []).map((n) => [n.to, n.from]));
  return new Map(data.query.pages.map((p) => [normalized.get(p.title) ?? p.title, p]));
}

const strip = (html = "") => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  clearDir(STAGING_DIR);

  const pages = new Map();
  for (let i = 0; i < CARDS.length; i += 40) {
    const batch = CARDS.slice(i, i + 40).map(([, title]) => title);
    for (const [k, v] of await queryInfo(batch)) pages.set(k, v);
  }

  const rows = [];
  const missing = [];
  for (const [id, title] of CARDS) {
    const page = pages.get(title);
    const info = page?.imageinfo?.[0];
    if (!info) {
      missing.push(`${id} (${title})`);
      continue;
    }
    const raw = join(RAW_DIR, `${id}.jpg`);
    const res = await fetch(info.thumburl ?? info.url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      missing.push(`${id} (download ${res.status})`);
      continue;
    }
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    execFileSync("cwebp", ["-quiet", "-q", "82", "-resize", String(WIDTH), "0", raw, "-o", join(OUT_DIR, `${id}.webp`)]);

    const meta = info.extmetadata ?? {};
    rows.push(
      `| ${id} | [${title.replace("File:", "")}](${info.descriptionurl}) | ${strip(meta.Artist?.value) || "—"} | ${strip(meta.LicenseShortName?.value) || "—"} |`,
    );
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 150));
  }

  writeFileSync(
    join(OUT_DIR, "SOURCES.md"),
    [
      "# rws-1909 牌组来源",
      "",
      "Rider–Waite–Smith 塔罗，Pamela Colman Smith 绘，1909 年首版（Rider & Son, London）。",
      "作者 1951 年去世，作品在美国（1929 年前出版）及作者终身 + 70 年的法域均已进入公有领域。",
      "只使用 Wikimedia Commons 上的原始扫描，未使用任何后期商业重绘 / 上色版本。",
      "",
      `抓取：\`node scripts/fetch-rws-deck.mjs\`，宽 ${WIDTH}px，cwebp q82。抓取日期：${new Date().toISOString().slice(0, 10)}`,
      "",
      "| card id | Commons 文件 | 作者（Commons 记录） | 许可（Commons 记录） |",
      "|---|---|---|---|",
      ...rows,
      "",
    ].join("\n"),
  );

  console.log(`\n抓取：${rows.length}/${CARDS.length}`);
  if (missing.length) console.log("抓取失败：\n  " + missing.join("\n  "));

  // 抓取不完整或校验不通过：不碰线上目录
  const problems = verifyDeck(STAGING_DIR, CARDS.map(([id]) => id), { width: WIDTH });
  if (missing.length || problems.length) {
    if (problems.length) console.log("暂存目录校验未通过：\n  " + problems.join("\n  "));
    console.log(`未更新 ${LIVE_DIR}（保持上一版）。暂存目录留在 ${STAGING_DIR} 供检查。`);
    process.exitCode = 1;
    return;
  }
  const backup = promoteStaged(STAGING_DIR, LIVE_DIR, BACKUP_DIR);
  console.log(`已更新 ${LIVE_DIR}。上一版备份在 ${backup ?? "（无）"}`);
}

main();
