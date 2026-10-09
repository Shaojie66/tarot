import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HistoryDetail } from "@/features/history/components/HistoryDetail";

export const metadata: Metadata = { title: "回看" };

export default function HistoryRecordPage({ params }: PageProps<"/history/[id]">) {
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-8">
      <Link href="/history" className="text-sm text-muted hover:text-ink">
        ← 历史
      </Link>
      <div className="mt-6">
        <Suspense fallback={<p className="py-10 text-center text-sm text-muted">正在翻开这条记录…</p>}>
          <Record params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Record({ params }: { params: PageProps<"/history/[id]">["params"] }) {
  const { id } = await params;
  return <HistoryDetail id={id} />;
}
