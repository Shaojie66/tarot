// 在 Node 里用假的 self / caches / fetch 执行 service worker 源码，验证它的生命周期与缓存策略。
// 浏览器里的真实离线行为见 e2e/pwa.spec.ts。

import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { SERVICE_WORKER_SOURCE } from "./sw-source";

type Listener = (event: Record<string, unknown>) => void;

function makeCaches(initial: Record<string, Record<string, string>> = {}) {
  const stores = new Map<string, Map<string, string>>(Object.entries(initial).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const key = (r: string | { url: string }) => (typeof r === "string" ? new URL(r, "https://app.test").href : r.url);
  const cache = (name: string) => ({
    async put(req: string | { url: string }, res: { body: string }) {
      stores.get(name)!.set(key(req), res.body);
    },
    async add(url: string) {
      stores.get(name)!.set(key(url), `asset:${url}`);
    },
    async match(req: string | { url: string }) {
      const hit = stores.get(name)!.get(key(req));
      return hit === undefined ? undefined : { body: hit, ok: true, fromCache: true };
    },
  });
  return {
    stores,
    api: {
      async open(name: string) {
        if (!stores.has(name)) stores.set(name, new Map());
        return cache(name);
      },
      async keys() {
        return [...stores.keys()];
      },
      async delete(name: string) {
        return stores.delete(name);
      },
    },
  };
}

function boot(options: { buildId?: string; online?: boolean; caches?: Record<string, Record<string, string>>; html?: Record<string, string> } = {}) {
  const listeners: Record<string, Listener> = {};
  const state = { online: options.online ?? true, skipWaiting: 0, claimed: 0, fetched: [] as string[] };
  const { stores, api } = makeCaches(options.caches);
  const pages = options.html ?? {
    "/": '<script src="/_next/static/chunks/a.js"></script><link href="/_next/static/css/b.css">',
  };
  const fetchImpl = async (input: string | { url: string }) => {
    const url = typeof input === "string" ? input : input.url;
    state.fetched.push(url);
    if (!state.online) throw new TypeError("offline");
    const path = new URL(url, "https://app.test").pathname;
    const body = pages[path] ?? `net:${path}`;
    return { ok: true, status: 200, body, text: async () => body, clone() { return { ...this }; } };
  };
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    skipWaiting: () => void state.skipWaiting++,
    clients: { claim: async () => void state.claimed++ },
  };
  const source = SERVICE_WORKER_SOURCE.replace("__BUILD_ID__", options.buildId ?? "b1");
  vm.runInNewContext(source, { self, caches: api, fetch: fetchImpl, URL, Response: class { status: number; constructor(public body: string, init: { status: number }) { this.status = init.status; } }, Promise, Set, Array, Object });
  const waitUntilOf = async (type: string, event: Record<string, unknown> = {}) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  const request = (path: string, init: { method?: string; mode?: string; origin?: string; rsc?: boolean } = {}) => {
    const url = new URL(path, init.origin ?? "https://app.test").href;
    return { url, method: init.method ?? "GET", mode: init.mode ?? "no-cors", headers: { get: (h: string) => (h === "RSC" && init.rsc ? "1" : null) } };
  };
  const fetchEvent = async (req: ReturnType<typeof request>): Promise<{ body: string; status?: number } | null> => {
    let responded: Promise<{ body: string; status?: number }> | null = null;
    listeners.fetch({ request: req, respondWith: (p: Promise<{ body: string; status?: number }>) => (responded = p) });
    return responded ? await (responded as Promise<{ body: string; status?: number }>).then((r) => r, (e: Error) => ({ body: `ERR:${e.message}` })) : null;
  };
  return { state, stores, waitUntilOf, request, fetchEvent, listeners };
}

describe("service worker 源码", () => {
  it("安装：预缓存页面及其引用的静态资源；不自动 skipWaiting（等用户确认）", async () => {
    const sw = boot();
    await sw.waitUntilOf("install");
    expect(sw.state.skipWaiting).toBe(0);
    const pages = sw.stores.get("tarot-pages-b1")!;
    const statics = sw.stores.get("tarot-static-b1")!;
    expect([...pages.keys()]).toContain("https://app.test/");
    expect([...statics.keys()].sort()).toEqual(["https://app.test/_next/static/chunks/a.js", "https://app.test/_next/static/css/b.css"]);
  });

  it("某个页面预缓存失败不让安装失败", async () => {
    const sw = boot({ online: false });
    await expect(sw.waitUntilOf("install")).resolves.toBeUndefined();
  });

  it("只有收到 SKIP_WAITING 才 skipWaiting", () => {
    const sw = boot();
    sw.listeners.message({ data: { type: "something-else" } });
    expect(sw.state.skipWaiting).toBe(0);
    sw.listeners.message({ data: { type: "SKIP_WAITING" } });
    expect(sw.state.skipWaiting).toBe(1);
  });

  it("激活：只清理旧版本的 tarot- 缓存，不动别人的缓存；然后接管页面", async () => {
    const sw = boot({
      buildId: "b2",
      caches: { "tarot-static-b1": { x: "1" }, "tarot-pages-b1": { y: "1" }, "tarot-static-b2": { z: "1" }, "tarot-pages-b2": {}, "other-app-cache": { k: "v" } },
    });
    await sw.waitUntilOf("activate");
    expect([...sw.stores.keys()].sort()).toEqual(["other-app-cache", "tarot-pages-b2", "tarot-static-b2"]);
    expect(sw.state.claimed).toBe(1);
  });

  it("不拦截 /api/*、/sw.js、非 GET、跨域：请求原样走网络", async () => {
    const sw = boot();
    for (const req of [sw.request("/api/reading"), sw.request("/api/status"), sw.request("/sw.js"), sw.request("/reading", { method: "POST" }), sw.request("/x.js", { origin: "https://cdn.example" })]) {
      expect(await sw.fetchEvent(req)).toBeNull();
    }
  });

  it("静态资源 cache-first：命中不走网络；未命中走网络并写入缓存", async () => {
    const sw = boot({ caches: { "tarot-static-b1": { "https://app.test/decks/rws-1909/the-fool.webp": "cached-card" }, "tarot-pages-b1": {} } });
    const hit = await sw.fetchEvent(sw.request("/decks/rws-1909/the-fool.webp"));
    expect(hit?.body).toBe("cached-card");
    expect(sw.state.fetched).toEqual([]);
    const miss = await sw.fetchEvent(sw.request("/_next/static/chunks/new.js"));
    expect(miss?.body).toBe("net:/_next/static/chunks/new.js");
    expect(sw.stores.get("tarot-static-b1")!.has("https://app.test/_next/static/chunks/new.js")).toBe(true);
  });

  it("页面 network-first：在线用网络并更新缓存；断网回退到缓存；没缓存的导航给离线说明页", async () => {
    const online = boot({ caches: { "tarot-static-b1": {}, "tarot-pages-b1": {} } });
    const first = await online.fetchEvent(online.request("/daily", { mode: "navigate" }));
    expect(first?.body).toBe("net:/daily");
    expect(online.stores.get("tarot-pages-b1")!.get("https://app.test/daily")).toBe("net:/daily");

    const offline = boot({ online: false, caches: { "tarot-static-b1": {}, "tarot-pages-b1": { "https://app.test/daily": "net:/daily" } } });
    expect((await offline.fetchEvent(offline.request("/daily", { mode: "navigate" })))?.body).toBe("net:/daily");
    const unknown = await offline.fetchEvent(offline.request("/history/abc", { mode: "navigate" }));
    expect(unknown?.status).toBe(503);
    expect(unknown?.body).toContain("现在离线，这个页面还没缓存");
  });

  it("RSC 请求也走 network-first 缓存（客户端导航离线可用）；API 响应从不进缓存", async () => {
    const sw = boot({ caches: { "tarot-static-b1": {}, "tarot-pages-b1": {} } });
    await sw.fetchEvent(sw.request("/history?_rsc=abc", { rsc: true }));
    expect(sw.stores.get("tarot-pages-b1")!.has("https://app.test/history?_rsc=abc")).toBe(true);
    await sw.fetchEvent(sw.request("/api/status"));
    for (const store of sw.stores.values()) for (const key of store.keys()) expect(key).not.toContain("/api/");
  });
});
