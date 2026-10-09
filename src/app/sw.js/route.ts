import { SERVICE_WORKER_SOURCE } from "@/features/pwa/sw-source";

/** Service worker 脚本。版本号随构建变化，旧版本缓存在新版本激活时清除。 */
export function GET() {
  return new Response(SERVICE_WORKER_SOURCE.replace("__BUILD_ID__", process.env.TAROT_BUILD_ID ?? "dev"), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // 浏览器每次都要重新检查 SW 脚本，否则更新发现会被 HTTP 缓存拖住
      "cache-control": "no-cache, no-store, must-revalidate",
      "service-worker-allowed": "/",
    },
  });
}
