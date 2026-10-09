"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 注册 service worker（只在生产构建、安全上下文里）。有新版本等待时显示横幅，用户确认后才切换并刷新。
 * 局域网 http 地址不是安全上下文，浏览器不允许 SW：页面照常在线可用，只是没有离线能力（见 README）。
 */
export function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  // 只有用户点了“立即更新”才会在接管后刷新；首次安装时 SW 接管页面不应该触发刷新
  const updateRequested = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
    let cancelled = false;
    const onController = () => {
      if (!updateRequested.current) return;
      updateRequested.current = false;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (cancelled) return;
        // 已经有新版本在等待（上次访问时装好的）
        if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) setWaiting(installing);
          });
        });
      })
      .catch(() => {
        // 注册失败不影响使用
      });
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" data-testid="pwa-update" className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm shadow-lg">
      <span>有新版本。更新会刷新页面，你正在填写的内容请先保存。</span>
      <button type="button" onClick={() => {
          updateRequested.current = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        }} className="shrink-0 rounded-full bg-accent px-4 py-1.5 text-bg">
        立即更新
      </button>
    </div>
  );
}
