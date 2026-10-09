// Service worker 源码（字符串，由 /sw.js 路由输出）。离线策略见 docs/pwa-offline.md。
//
// 缓存什么：
//   - 静态资源（/_next/static、/decks、/icons）：cache-first，内容带哈希或不变。
//   - 页面与 RSC 请求：network-first，成功就更新缓存，断网回退到上次缓存。页面是静态外壳，不含用户内容。
// 永远不缓存：/api/*（含问题与结果的请求与响应）、/sw.js 本身、非 GET、跨域。
// 更新：新版本安装后 **不** 自动接管，等用户确认（页面横幅）或所有标签页关闭后才激活，避免旧页面拿到被清掉的旧资源。

export const SERVICE_WORKER_SOURCE = String.raw`
const BUILD_ID = "__BUILD_ID__";
const STATIC_CACHE = "tarot-static-" + BUILD_ID;
const PAGE_CACHE = "tarot-pages-" + BUILD_ID;
const PRECACHE_PAGES = ["/", "/reading", "/daily", "/history", "/settings", "/cards"];

const OFFLINE_HTML = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线</title><body style="background:#15131b;color:#ece4d4;font-family:system-ui,sans-serif;padding:2rem;line-height:1.7"><h1 style="font-size:1.3rem">现在离线，这个页面还没缓存</h1><p>在线时打开过的页面，断网后也能看。你保存的记录都在这台设备上，不受影响。</p><p><a style="color:#d6a65c" href="/">回到首页</a></p></body></html>';

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const pages = await caches.open(PAGE_CACHE);
      const statics = await caches.open(STATIC_CACHE);
      for (const url of PRECACHE_PAGES) {
        try {
          const res = await fetch(url, { cache: "reload" });
          if (!res.ok) continue;
          await pages.put(url, res.clone());
          // 页面引用的脚本 / 样式一并预缓存，否则只有 HTML 没有 JS，离线打开是个不能交互的壳
          const html = await res.text();
          const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s)<>]+/g) || []);
          await Promise.all([...assets].map((a) => statics.add(a).catch(() => {})));
        } catch (e) {
          // 某个页面预缓存失败不应让整个 SW 安装失败
        }
      }
      // 不调用 skipWaiting：等用户确认或所有标签页关闭
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "GET_VERSION" && event.ports[0]) event.ports[0].postMessage({ buildId: BUILD_ID });
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGE_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith("tarot-") && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/decks/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return; // 不拦截：请求原样走网络

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(PAGE_CACHE);
      try {
        const res = await fetch(request);
        if (res.ok && (request.mode === "navigate" || request.headers.get("RSC") || url.pathname === "/manifest.webmanifest")) {
          cache.put(request, res.clone());
        }
        return res;
      } catch (e) {
        const hit = await cache.match(request);
        if (hit) return hit;
        if (request.mode === "navigate") return new Response(OFFLINE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
        throw e;
      }
    })(),
  );
});
`;
