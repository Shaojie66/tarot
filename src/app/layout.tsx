import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { PwaRegister } from "@/features/pwa/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "此刻三张牌", template: "%s · 此刻三张牌" },
  description: "抽三张牌，和自己聊一小会儿。自我反思工具，不预测未来。",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "此刻三张牌", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#15131b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line/70">
          <nav className="mx-auto flex max-w-3xl items-center justify-between px-3 py-1 text-sm">
            <Link href="/" className="inline-flex min-h-11 items-center px-2 font-serif text-base tracking-[0.18em]">
              此刻三张牌
            </Link>
            <div className="flex flex-wrap justify-end">
              <Link href="/reading" className="inline-flex min-h-11 items-center px-2 text-muted hover:text-ink">
                抽牌
              </Link>
              <Link href="/daily" className="inline-flex min-h-11 items-center px-2 text-muted hover:text-ink">
                每日
              </Link>
              <Link href="/history" className="inline-flex min-h-11 items-center px-2 text-muted hover:text-ink">
                历史
              </Link>
              <Link href="/settings" className="inline-flex min-h-11 items-center px-2 text-muted hover:text-ink">
                设置
              </Link>
              <Link href="/cards" className="inline-flex min-h-11 items-center px-2 text-muted hover:text-ink">
                牌义百科
              </Link>
            </div>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
        <PwaRegister />
      </body>
    </html>
  );
}
