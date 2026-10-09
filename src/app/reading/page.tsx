import type { Metadata } from "next";
import { ReadingFlow } from "@/features/reading/components/ReadingFlow";

export const metadata: Metadata = {
  title: "抽三张牌",
  description: "选一个主题，问自己一个问题，抽三张牌：此刻、阻碍、下一步。",
};

export default function ReadingPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-8">
      <h1 className="sr-only">抽三张牌</h1>
      <ReadingFlow />
    </main>
  );
}
