// 本机 API 的请求防护：只接受同源的 application/json 请求，默认只接受回环地址访问。
// 目的：恶意网页不能借浏览器用宿主的 key 调模型（text/plain 跨域"简单请求"不触发 CORS 预检），
// 同网段设备默认也不能匿名调用。局域网访问须显式设置 TAROT_ALLOW_LAN=1（见 README 的 start:lan）。

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostName(host: string): string {
  // 形如 "[::1]:3000" / "localhost:3000" / "example.com"
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0];
}

function deny(status: number, code: "forbidden" | "bad_request"): Response {
  return Response.json({ type: "error", code }, { status });
}

export function lanAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.TAROT_ALLOW_LAN === "1";
}

/** 通过返回 null；不通过返回应直接响应的 Response。 */
export function guardApiRequest(
  request: Request,
  options: { json: boolean },
  env: Record<string, string | undefined> = process.env,
): Response | null {
  const host = request.headers.get("host") ?? "";
  if (!lanAllowed(env) && !LOOPBACK_HOSTS.has(hostName(host).toLowerCase())) return deny(403, "forbidden");

  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return deny(403, "forbidden");
    }
    if (originHost.toLowerCase() !== host.toLowerCase()) return deny(403, "forbidden");
  }

  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return deny(403, "forbidden");

  if (options.json) {
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return deny(415, "bad_request");
  }
  return null;
}
