// 牌组资源：线上目录完整性，以及抓图脚本的“暂存 → 校验 → 替换”逻辑（不联网）。

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { promoteStaged, verifyDeck, webpSize } from "../../../scripts/lib/deck-staging.mjs";
import { ALL_CARD_IDS } from "./ids";

const LIVE = fileURLToPath(new URL("../../../public/decks/rws-1909", import.meta.url));
const ids = [...ALL_CARD_IDS] as string[];
const temps: string[] = [];
afterEach(() => temps.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function tempDir() {
  const d = mkdtempSync(join(tmpdir(), "tarot-deck-"));
  temps.push(d);
  return d;
}

/** 复制一份线上目录作为“暂存”。 */
function stagedCopy() {
  const dir = join(tempDir(), "rws-1909");
  mkdirSync(dir);
  for (const f of readdirSync(LIVE)) copyFileSync(join(LIVE, f), join(dir, f));
  return dir;
}

describe("线上牌组 rws-1909", () => {
  it("78 张都在、是 600 宽的有效 WebP，SOURCES.md 每张都有来源且作者 / 许可齐全", () => {
    expect(ids).toHaveLength(78);
    expect(verifyDeck(LIVE, ids)).toEqual([]);
  });

  it("webpSize 能读出尺寸，非 WebP 返回 null", () => {
    expect(webpSize(readFileSync(join(LIVE, "the-fool.webp")))?.width).toBe(600);
    expect(webpSize(Buffer.from("not a webp file at all, definitely not riffwebp...."))).toBeNull();
  });
});

describe("verifyDeck 能发现不完整的暂存目录", () => {
  it("缺图 / 损坏图 / 尺寸异常 / 缺来源行 / 多余图", () => {
    const dir = stagedCopy();
    rmSync(join(dir, "the-fool.webp"));
    writeFileSync(join(dir, "death.webp"), Buffer.alloc(8000, 1));
    writeFileSync(join(dir, "extra-card.webp"), readFileSync(join(LIVE, "the-sun.webp")));
    const sources = readFileSync(join(dir, "SOURCES.md"), "utf8").split("\n").filter((l) => !l.startsWith("| the-star |")).join("\n");
    writeFileSync(join(dir, "SOURCES.md"), sources);
    const problems = verifyDeck(dir, ids) as string[];
    expect(problems).toContain("缺图：the-fool.webp");
    expect(problems).toContain("不是有效的 WebP：death.webp");
    expect(problems).toContain("多余的图：extra-card.webp");
    expect(problems).toContain("SOURCES.md 缺少来源行：the-star");
  });

  it("目录不存在 / 缺 SOURCES.md", () => {
    expect(verifyDeck(join(tempDir(), "none"), ids)[0]).toContain("目录不存在");
    const dir = stagedCopy();
    rmSync(join(dir, "SOURCES.md"));
    expect(verifyDeck(dir, ids)).toContain("缺少 SOURCES.md");
  });
});

describe("promoteStaged：成功才替换，旧版留备份；失败还原", () => {
  it("替换后线上是新内容，旧版在备份里", () => {
    const root = tempDir();
    const live = join(root, "live");
    const staged = join(root, "staged");
    mkdirSync(live);
    mkdirSync(staged);
    writeFileSync(join(live, "a.txt"), "old");
    writeFileSync(join(staged, "a.txt"), "new");
    const backup = promoteStaged(staged, live, join(root, "backup"), "t1");
    expect(readFileSync(join(live, "a.txt"), "utf8")).toBe("new");
    expect(readFileSync(join(backup!, "a.txt"), "utf8")).toBe("old");
    expect(existsSync(staged)).toBe(false);
  });

  it("暂存目录不存在（改名失败）：线上保持原样，旧版被还原", () => {
    const root = tempDir();
    const live = join(root, "live");
    mkdirSync(live);
    writeFileSync(join(live, "a.txt"), "old");
    expect(() => promoteStaged(join(root, "missing"), live, join(root, "backup"), "t2")).toThrow();
    expect(readFileSync(join(live, "a.txt"), "utf8")).toBe("old");
  });
});
