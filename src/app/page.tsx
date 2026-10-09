import Link from "next/link";
import { RecallBanner } from "@/features/recall/RecallBanner";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
      <RecallBanner />
      <span aria-hidden className="rise block h-px w-10 bg-accent" />
      <h1 className="diary-title rise mt-8" style={{ "--i": 1 } as React.CSSProperties}>
        有点迷茫？
        <br />
        抽三张牌，
        <br />
        和自己聊一小会儿。
      </h1>
      <p className="rise mt-6 max-w-sm text-sm leading-relaxed text-muted" style={{ "--i": 2 } as React.CSSProperties}>
        这是一个自我反思工具，不预测未来。牌是随机抽的，怎么理解由你决定。
      </p>
      <div className="rise mt-10" style={{ "--i": 3 } as React.CSSProperties}>
        <Link href="/reading" className="inline-flex min-h-11 items-center rounded-full bg-accent px-7 text-bg transition-opacity hover:opacity-90">
          开始
        </Link>
      </div>
      <nav aria-label="其他入口" className="rise mt-16 hairline" style={{ "--i": 4 } as React.CSSProperties}>
        {[
          ["/daily", "只想抽一张？每日一张"],
          ["/cards", "先看看牌义百科"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="flex min-h-12 items-center justify-between border-b border-line text-sm text-muted transition-colors hover:text-ink">
            <span>{label}</span>
            <span aria-hidden>→</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
