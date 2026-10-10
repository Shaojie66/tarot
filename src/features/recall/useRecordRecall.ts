"use client";

import { useEffect, useState } from "react";
import { recallForRecord, subscribe, type Recall } from "./recall";

/** 某条记录上的回读，跟随本页写入 / 其他标签页 / 回到前台 / 到期时间刷新。挂载前为 undefined（尚未读取）。 */
export function useRecordRecall(recordId: string): Recall | null | undefined {
  const [recall, setRecall] = useState<Recall | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) setRecall(typeof localStorage === "undefined" ? null : (recallForRecord(recordId) ?? null));
    };
    Promise.resolve().then(refresh);
    const unsubscribe = subscribe(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [recordId]);
  return recall;
}
