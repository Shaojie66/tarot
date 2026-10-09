import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CardImage } from "@/components/CardImage";
import { SUIT_INFO, findCard, getAllCards } from "@/features/cards/cards";
import { TOPICS, TOPIC_LABELS, type CardSide } from "@/features/cards/schema";

export function generateStaticParams() {
  return getAllCards().map((card) => ({ id: card.id }));
}

export async function generateMetadata({ params }: PageProps<"/cards/[id]">): Promise<Metadata> {
  const card = findCard((await params).id);
  if (!card) return {};
  return {
    title: `${card.nameZh} ${card.nameEn}`,
    description: `${card.nameZh}正位：${card.upright.meaning} 逆位：${card.reversed.meaning}`,
  };
}

export default function CardPage({ params }: PageProps<"/cards/[id]">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <Link href="/cards" className="text-sm text-muted hover:text-ink">
        ← 牌义百科
      </Link>
      <Suspense fallback={<CardSkeleton />}>
        <CardDetail params={params} />
      </Suspense>
    </main>
  );
}

async function CardDetail({ params }: { params: PageProps<"/cards/[id]">["params"] }) {
  const card = findCard((await params).id);
  if (!card) notFound();

  const all = getAllCards();
  const index = all.findIndex((c) => c.id === card.id);
  const prev = all[(index - 1 + all.length) % all.length];
  const next = all[(index + 1) % all.length];
  const group = card.suit ? `${SUIT_INFO[card.suit].nameZh} · ${SUIT_INFO[card.suit].element}` : `大阿卡纳 · ${card.number}`;

  return (
    <>
      <div className="mt-6 grid gap-8 sm:grid-cols-[220px_1fr]">
        <div className="mx-auto w-48 sm:w-full">
          <CardImage card={card} priority sizes="(min-width: 640px) 220px, 192px" />
        </div>
        <div>
          <p className="text-xs tracking-widest text-accent">{group}</p>
          <h1 className="mt-1 font-serif text-3xl">{card.nameZh}</h1>
          <p className="text-sm text-muted">{card.nameEn}</p>
          <Side title="正位" side={card.upright} />
        </div>
      </div>

      <div className="mt-10 border-t border-line pt-8">
        <Side title="逆位" side={card.reversed} />
      </div>

      <nav className="mt-12 flex justify-between border-t border-line pt-6 text-sm">
        <Link href={`/cards/${prev.id}`} prefetch className="text-muted hover:text-ink">
          ← {prev.nameZh}
        </Link>
        <Link href={`/cards/${next.id}`} prefetch className="text-muted hover:text-ink">
          {next.nameZh} →
        </Link>
      </nav>
    </>
  );
}

function CardSkeleton() {
  return (
    <div className="mt-6 grid animate-pulse gap-8 sm:grid-cols-[220px_1fr]" aria-hidden>
      <div className="mx-auto aspect-[600/1035] w-48 rounded-lg bg-surface sm:w-full" />
      <div className="space-y-3">
        <div className="h-3 w-24 rounded bg-surface" />
        <div className="h-8 w-32 rounded bg-surface" />
        <div className="h-20 rounded bg-surface" />
      </div>
    </div>
  );
}

function Side({ title, side }: { title: string; side: CardSide }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="font-serif text-xl">{title}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {side.keywords.map((k) => (
          <li key={k} className="rounded-full border border-accent/40 px-3 py-0.5 text-sm text-accent">
            {k}
          </li>
        ))}
      </ul>
      <p className="mt-4 leading-relaxed">{side.meaning}</p>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        {TOPICS.map((topic) => (
          <div key={topic} className="rounded-lg bg-surface p-3">
            <dt className="text-xs text-muted">{TOPIC_LABELS[topic]}</dt>
            <dd className="mt-1 text-sm leading-relaxed">{side[topic]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 border-l-2 border-accent pl-3 font-serif text-base">{side.question}</p>
    </section>
  );
}
