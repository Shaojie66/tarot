import type { Metadata } from "next";
import { SettingsPanel } from "@/features/settings/SettingsPanel";

export const metadata: Metadata = { title: "设置", description: "逆位牌、牌组，以及 AI 配置状态。" };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-8">
      <h1 className="mb-6 font-serif text-2xl">设置</h1>
      <SettingsPanel />
    </main>
  );
}
