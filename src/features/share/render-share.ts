// 把 ShareModel 画成 PNG。只在浏览器里运行，只读 ShareModel（不接触记录），不联网（牌面图是本站同源静态文件）。

import { DECKS } from "@/features/cards/deck";
import type { ShareModel } from "./share-model";

const W = 1080;
const PAD = 64;
const GAP = 32;
const COLORS = { bg: "#15131b", surface: "#1e1b26", line: "#2f2b39", ink: "#ece4d4", muted: "#9b9184", accent: "#d6a65c" };
const SERIF = '"Songti SC","Noto Serif SC","Source Han Serif SC","STSong",serif';
const SANS = '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${src}`));
    img.src = src;
  });
}

/** 按宽度折行（中文逐字、英文遇空格也可断）。 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text.replace(/\s+/g, " ").trim()) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = ch === " " ? "" : ch;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderShareImage(model: ShareModel): Promise<Blob> {
  const deck = DECKS[model.deckId];
  const images = await Promise.all(model.cards.map((c) => loadImage(c.imageSrc)));
  const count = model.cards.length;
  const cardW = Math.floor((W - PAD * 2 - GAP * (count - 1)) / count);
  const cardH = Math.round((cardW * deck.height) / deck.width);

  // 先在一个临时画布上量文字，算出总高度
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `30px ${SERIF}`;
  const textBlocks: { label: string; lines: string[] }[] = [];
  if (model.question) textBlocks.push({ label: "我的问题", lines: wrap(probe, model.question, W - PAD * 2 - 48) });
  if (model.action) textBlocks.push({ label: "我的小行动", lines: wrap(probe, model.action, W - PAD * 2 - 48) });
  const blocksH = textBlocks.reduce((h, b) => h + 28 + 44 + b.lines.length * 46 + 28 + 24, 0);

  const titleH = 150;
  const captionH = 150;
  const H = titleH + cardH + captionH + blocksH + 190;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 52px ${SERIF}`;
  ctx.fillText(model.title, W / 2, 96);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(W / 2 - 40, 120, 80, 3);

  model.cards.forEach((card, i) => {
    const x = PAD + i * (cardW + GAP);
    const y = titleH;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    if (card.reversed) {
      ctx.translate(x + cardW / 2, y + cardH / 2);
      ctx.rotate(Math.PI);
      ctx.drawImage(images[i], -cardW / 2, -cardH / 2, cardW, cardH);
    } else {
      ctx.drawImage(images[i], x, y, cardW, cardH);
    }
    ctx.restore();

    const cx = x + cardW / 2;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `24px ${SANS}`;
    ctx.fillText(card.positionLabel, cx, y + cardH + 44);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 32px ${SERIF}`;
    ctx.fillText(`${card.nameZh}${card.reversed ? "（逆位）" : ""}`, cx, y + cardH + 88);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `22px ${SANS}`;
    ctx.fillText(card.keywords.join(" · "), cx, y + cardH + 124);
  });

  let y = titleH + cardH + captionH;
  ctx.textAlign = "left";
  for (const block of textBlocks) {
    const boxH = 28 + 44 + block.lines.length * 46 + 28;
    ctx.fillStyle = COLORS.surface;
    ctx.fillRect(PAD, y, W - PAD * 2, boxH);
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(PAD, y, 5, boxH);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `22px ${SANS}`;
    ctx.fillText(block.label, PAD + 28, y + 40);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `30px ${SERIF}`;
    block.lines.forEach((line, i) => ctx.fillText(line, PAD + 28, y + 28 + 44 + i * 46 + 16));
    y += boxH + 24;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(PAD, H - 150, W - PAD * 2, 2);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `22px ${SANS}`;
  ctx.fillText(model.disclaimer, W / 2, H - 98);
  ctx.fillText(`牌面：${model.attribution}`, W / 2, H - 58);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}
