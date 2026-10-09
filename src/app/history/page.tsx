import type { Metadata } from "next";
import { HistoryList } from "@/features/history/components/HistoryList";
import { RecallBanner } from "@/features/recall/RecallBanner";

export const metadata: Metadata = {
  title: "历史",
  description: "回看你保存在这个浏览器里的每一次占卜、当时的选择和后来的感受。",
};

export default function HistoryPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-8">
      <h1 className="mb-1 font-serif text-2xl">历史</h1>
      <p className="mb-6 text-xs leading-relaxed text-muted">记录只保存在这个浏览器里，不会上传。换浏览器或设备不会同步，请用备份。</p>
      <RecallBanner />
      <HistoryList />
    </main>
  );
}
