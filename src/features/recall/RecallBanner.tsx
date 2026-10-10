"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getRecord } from "@/features/reading/storage";
import { dismissRecall, expiredRecalls, removeRecallsForRecord, subscribe, type Recall } from "@/features/recall/recall";

/**
 * "未来回读"到期提示：几天前抽的牌到了回看的日子，回来看看当时的自己。
 * 定位是"回看当时的自己"，不是行动督促。两个出口：去回看（只打开，不改变状态）/ 不再提醒（永久结束这一条）。
 * 多条到期时按最早到期优先，处理一条再显示下一条。
 * 用 useState + useEffect 订阅（挂载后才读 localStorage），避免 useSyncExternalStore 快照不稳定与预渲染期 new Date()。
 */
export function RecallBanner() {
  // 服务端预渲染没有 localStorage，也不能在渲染期调用 new Date()（cacheComponents 会让整页预渲染失败）：
  // 初始为空，挂载后再读，之后跟随订阅刷新（本页写入、其他标签页、回到前台、跨过到期时间）。
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      const due = typeof localStorage === "undefined" ? [] : expiredRecalls();
      setRecalls(due);
      // 对应的记录已不存在 → 清掉这条提醒，不留指向空页面的提示
      for (const r of due) {
        getRecord(r.recordId).then(
          (record) => {
            if (!record && !cancelled) removeRecallsForRecord(r.recordId);
          },
          () => {},
        );
      }
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
    <div role="status" className="hairline mb-8 space-y-2 border-b border-line py-4 text-sm leading-relaxed" data-testid="recall-banner">
      <p>{recalls.length > 1 ? `有 ${recalls.length} 条记录到了回看的日子。` : "有一条记录到了回看的日子。"}</p>
      <p className="flex flex-wrap items-center gap-x-5">
        <Link href={`/history/${first.recordId}#review`} className="inline-flex min-h-11 items-center text-accent underline underline-offset-4">
          去回看
        </Link>
        <button
          type="button"
          onClick={() => setFailed(!dismissRecall(first.id))}
          className="inline-flex min-h-11 items-center text-muted underline underline-offset-4"
        >
          不再提醒
        </button>
      </p>
      {failed && <p className="text-xs text-muted">没能保存，提醒还在。浏览器存储可能不可用，可以再试一次。</p>}
    </div>
  );
}
