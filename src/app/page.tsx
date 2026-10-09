import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <h1 className="font-serif text-2xl leading-snug sm:text-3xl">
        有点迷茫？
        <br />
        抽三张牌，和自己聊两分钟。
      </h1>
      <p className="max-w-sm text-sm text-muted">这是一个自我反思工具，不预测未来。占卜流程正在建设中。</p>
      <Link href="/cards" className="rounded-full border border-accent px-5 py-2 text-sm text-accent hover:bg-accent hover:text-bg">
        先看看牌义百科
      </Link>
    </main>
  );
}
