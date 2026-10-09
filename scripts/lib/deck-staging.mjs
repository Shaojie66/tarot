// 牌组资源的“暂存 → 全量校验 → 成功才替换”。抓图脚本用它，测试也直接用它。
// 目标：抓取失败或不完整时，线上使用的牌面和 SOURCES.md 保持上一版完整，不会出现一半新一半旧。

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const MIN_BYTES = 4_000;

/** 读 WebP 的像素尺寸（支持 VP8 / VP8L / VP8X）。不是合法 WebP 返回 null。 */
export function webpSize(buf) {
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = buf.toString("ascii", 12, 16);
  if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  return null;
}

/**
 * 校验一个牌组目录：每个 id 都有可解码尺寸的 WebP、宽度一致、SOURCES.md 为每张牌各有一行来源。
 * 返回问题列表；空数组表示通过。
 */
export function verifyDeck(dir, ids, { width = 600 } = {}) {
  const problems = [];
  if (!existsSync(dir)) return [`目录不存在：${dir}`];
  const files = new Set(readdirSync(dir));
  for (const id of ids) {
    const name = `${id}.webp`;
    if (!files.has(name)) {
      problems.push(`缺图：${name}`);
      continue;
    }
    const path = join(dir, name);
    if (statSync(path).size < MIN_BYTES) {
      problems.push(`文件过小：${name}`);
      continue;
    }
    const size = webpSize(readFileSync(path));
    if (!size) problems.push(`不是有效的 WebP：${name}`);
    else if (size.width !== width || size.height < width || size.height > width * 2) problems.push(`尺寸异常：${name} ${size.width}×${size.height}`);
  }
  const extra = [...files].filter((f) => f.endsWith(".webp") && !ids.includes(f.slice(0, -5)));
  if (extra.length) problems.push(`多余的图：${extra.join(", ")}`);

  const sourcesPath = join(dir, "SOURCES.md");
  if (!files.has("SOURCES.md")) problems.push("缺少 SOURCES.md");
  else {
    const rows = readFileSync(sourcesPath, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| card id") && !l.startsWith("|---"));
    const listed = new Set(rows.map((l) => l.split("|")[1].trim()));
    for (const id of ids) if (!listed.has(id)) problems.push(`SOURCES.md 缺少来源行：${id}`);
    for (const row of rows) if (/\|\s*—\s*\|/.test(row)) problems.push(`SOURCES.md 作者或许可缺失：${row.split("|")[1].trim()}`);
  }
  return problems;
}

/**
 * 把校验通过的暂存目录替换线上目录。旧目录先改名为备份，再把暂存目录改名过去；
 * 任何一步失败都把备份还原。返回备份目录路径（调用方可保留或清理）。
 * 要求 staged / live / backupRoot 在同一文件系统（项目目录内），保证 rename 原子。
 */
export function promoteStaged(staged, live, backupRoot, stamp = new Date().toISOString().replace(/[:.]/g, "-")) {
  mkdirSync(backupRoot, { recursive: true });
  const backup = join(backupRoot, `${stamp}-${live.split("/").pop()}`);
  const hadLive = existsSync(live);
  if (hadLive) renameSync(live, backup);
  try {
    renameSync(staged, live);
  } catch (error) {
    if (hadLive) renameSync(backup, live);
    throw error;
  }
  return hadLive ? backup : null;
}

export function clearDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
