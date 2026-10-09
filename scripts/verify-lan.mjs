// 局域网授权矩阵：真实起服务，用本机的局域网 IP 去连，验证“默认只在本机、显式开启才开放”。
// 用法：pnpm build && node scripts/verify-lan.mjs
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
if (!lanIp) {
  console.log("没有找到非回环的 IPv4 地址，无法验证局域网矩阵。");
  process.exit(2);
}

const CONFIGS = [
  { name: "默认（pnpm start：绑 127.0.0.1，未授权）", args: ["--hostname", "127.0.0.1"], env: {}, port: 3331 },
  { name: "误配（绑 0.0.0.0，但未设 TAROT_ALLOW_LAN）", args: ["--hostname", "0.0.0.0"], env: {}, port: 3332 },
  { name: "显式开启（pnpm start:lan：绑 0.0.0.0 + TAROT_ALLOW_LAN=1）", args: ["--hostname", "0.0.0.0"], env: { TAROT_ALLOW_LAN: "1" }, port: 3333 },
];

async function probe(url, init = {}) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) });
    return String(res.status);
  } catch {
    return "连不上";
  }
}

async function waitUp(port) {
  for (let i = 0; i < 60; i++) {
    if ((await probe(`http://127.0.0.1:${port}/api/status`)) !== "连不上" || (await probe(`http://localhost:${port}/`)) !== "连不上") return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const rows = [];
for (const cfg of CONFIGS) {
  const child = spawn("pnpm", ["exec", "next", "start", "--port", String(cfg.port), ...cfg.args], {
    cwd: ROOT,
    env: { ...process.env, ANTHROPIC_API_KEY: "", TAROT_ALLOW_LAN: "", ...cfg.env },
    stdio: "ignore",
  });
  const up = await waitUp(cfg.port);
  const lan = `http://${lanIp}:${cfg.port}`;
  const json = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "合成问题", topic: "career" }) };
  rows.push({
    配置: cfg.name,
    本机页面: up ? await probe(`http://localhost:${cfg.port}/`) : "没启动",
    本机API: up ? await probe(`http://localhost:${cfg.port}/api/status`) : "没启动",
    局域网页面: up ? await probe(`${lan}/`) : "没启动",
    局域网API状态: up ? await probe(`${lan}/api/status`) : "没启动",
    局域网API_JSON: up ? await probe(`${lan}/api/rewrite`, json) : "没启动",
    局域网跨站Origin: up ? await probe(`${lan}/api/rewrite`, { ...json, headers: { ...json.headers, origin: "https://evil.example" } }) : "没启动",
    局域网text_plain: up ? await probe(`${lan}/api/rewrite`, { ...json, headers: { "content-type": "text/plain" } }) : "没启动",
  });
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 800));
}
console.log(`局域网 IP：${lanIp}\n`);
console.table(rows);
