import Image from "next/image";
import type { Card } from "@/features/cards/cards";
import { DECKS, DEFAULT_DECK, cardImageSrc, type DeckId } from "@/features/cards/deck";

interface CardImageProps {
  card: Pick<Card, "id" | "nameZh">;
  reversed?: boolean;
  deck?: DeckId;
  priority?: boolean;
  sizes?: string;
  className?: string;
}

/** 牌面图。图片已预先压成 WebP，关闭运行时优化，自托管不依赖 sharp。 */
export function CardImage({ card, reversed = false, deck = DEFAULT_DECK, priority, sizes, className = "" }: CardImageProps) {
  const { width, height } = DECKS[deck];
  return (
    <Image
      src={cardImageSrc(card.id, deck)}
      alt={reversed ? `${card.nameZh}（逆位）` : card.nameZh}
      width={width}
      height={height}
      unoptimized
      priority={priority}
      sizes={sizes}
      className={`h-auto w-full rounded-lg shadow-lg shadow-black/40 ${reversed ? "rotate-180" : ""} ${className}`}
    />
  );
}
