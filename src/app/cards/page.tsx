import type { Metadata } from "next";
import Link from "next/link";
import { CardImage } from "@/components/CardImage";
import { SUIT_INFO, getAllCards, type Card } from "@/features/cards/cards";
import { SUITS } from "@/features/cards/ids";

export const metadata: Metadata = {
  title: "牌义百科",
  description: "78 张塔罗牌的正位与逆位含义，以及在事业、关系、自我、去留四个方面的解读。",
};

export default function CardsIndexPage() {
  const cards = getAllCards();
  const groups: { key: string; title: string; subtitle: string; cards: Card[] }[] = [
    {
      key: "major",
      title: "大阿卡纳",
      subtitle: "人生阶段与重要课题",
      cards: cards.filter((c) => c.arcana === "major"),
    },
    ...SUITS.map((suit) => ({
      key: suit,
      title: SUIT_INFO[suit].nameZh,
      subtitle: `${SUIT_INFO[suit].element} · ${SUIT_INFO[suit].theme}`,
      cards: cards.filter((c) => c.suit === suit),
    })),
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <h1 className="font-serif text-2xl">牌义百科</h1>
      <p className="mt-2 text-sm text-muted">每张牌描述的是一种状态和张力，不是会发生什么。</p>

      <nav className="mt-6 flex flex-wrap gap-2 text-sm">
        {groups.map((g) => (
          <a key={g.key} href={`#${g.key}`} className="rounded-full border border-line px-3 py-1 text-muted hover:text-ink">
            {g.title}
          </a>
        ))}
      </nav>

      {groups.map((g) => (
        <section key={g.key} id={g.key} className="mt-10 scroll-mt-4">
          <h2 className="font-serif text-xl">{g.title}</h2>
          <p className="mt-1 text-xs text-muted">{g.subtitle}</p>
          <ul className="mt-4 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-5">
            {g.cards.map((card) => (
              <li key={card.id}>
                <Link href={`/cards/${card.id}`} className="group block">
                  <CardImage card={card} sizes="(min-width: 640px) 20vw, 33vw" className="transition group-hover:-translate-y-1" />
                  <span className="mt-2 block text-center text-sm">{card.nameZh}</span>
                  <span className="block text-center text-xs text-muted">{card.upright.keywords.join(" · ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
