"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dismissRecall, expiredRecalls, subscribe, type Recall } from "@/features/recall/recall";

/**
 * "未来回读"到期提示：几天前抽的牌到了回看的日子，回来看看当时的自己。
 * 定位是"回看当时的自己"，不是行动督促；可随时忽略（dismiss），忽略后不再提示。
 * 用 useState + useEffect 订阅（挂载后才读 localStorage），避免 useSyncExternalStore 快照不稳定与预渲染期 new Date()。
 */
export function RecallBanner() {
  // 服务端预渲染没有 localStorage，也不能在渲染期调用 new Date()（cacheComponents 会让整页预渲染失败）：
  // 初始为空，挂载后再读，之后跟随订阅刷新。
  const [recalls, setRecalls] = useState<Recall[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) setRecalls(typeof localStorage === "undefined" ? [] : expiredRecalls());
    };
    Promise.resolve().then(refresh);
    const unsubscribe = subscribe(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (recalls.length === 0) return null;

  const first = recalls[0];
  return (
    <p role="status" className="hairline mb-8 border-b border-line py-4 text-sm leading-relaxed" data-testid="recall-banner">
      几天前你抽过牌，回来看看当时的自己？{" "}
      <Link href={`/history/${first.recordId}`} className="text-accent underline underline-offset-4">
        去看看
      </Link>{" "}
      <button type="button" onClick={() => dismissRecall(first.id)} className="text-muted underline underline-offset-4">
        先不管
      </button>
    </p>
  );
}
