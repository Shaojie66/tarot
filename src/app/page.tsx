import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <h1 className="font-serif text-2xl leading-snug sm:text-3xl">
        有点迷茫？
        <br />
        抽三张牌，和自己聊两分钟。
      </h1>
      <p className="max-w-sm text-sm text-muted">这是一个自我反思工具，不预测未来。牌是随机抽的，怎么理解由你决定。</p>
      <Link href="/reading" className="rounded-full bg-accent px-6 py-2.5 text-bg hover:opacity-90">
        开始
      </Link>
      <Link href="/cards" className="text-sm text-muted underline underline-offset-4 hover:text-ink">
        先看看牌义百科
      </Link>
    </main>
  );
}
