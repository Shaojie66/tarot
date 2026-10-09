import type { Metadata } from "next";
import { DailyCard } from "@/features/daily/DailyCard";

export const metadata: Metadata = { title: "每日一张", description: "每天抽一张牌，留意一个反思问题。不预测今天会发生什么。" };

export default function DailyPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-8">
      <h1 className="mb-2 font-serif text-2xl">每日一张</h1>
      <DailyCard />
    </main>
  );
}
