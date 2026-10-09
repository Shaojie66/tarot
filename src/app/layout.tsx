import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "此刻三张牌", template: "%s · 此刻三张牌" },
  description: "抽三张牌，和自己聊两分钟。自我反思工具，不预测未来。",
};

export const viewport: Viewport = {
  themeColor: "#15131b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line">
          <nav className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3 text-sm">
            <Link href="/" className="font-serif text-base tracking-wide">
              此刻三张牌
            </Link>
            <div className="flex gap-4">
              <Link href="/reading" className="text-muted hover:text-ink">
                抽牌
              </Link>
              <Link href="/cards" className="text-muted hover:text-ink">
                牌义百科
              </Link>
            </div>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
