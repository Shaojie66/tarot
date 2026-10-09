import { describe, expect, it } from "vitest";
import { guardApiRequest } from "./guard";

function req(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/reading", { method: "POST", headers, body: "{}" });
}
const json = { "content-type": "application/json", host: "localhost:3000" };

describe("guardApiRequest", () => {
  it("放行同源 JSON 请求（有 / 无 Origin）", () => {
    expect(guardApiRequest(req(json), { json: true }, {})).toBeNull();
    expect(guardApiRequest(req({ ...json, origin: "http://localhost:3000" }), { json: true }, {})).toBeNull();
    expect(guardApiRequest(req({ ...json, "content-type": "application/json; charset=utf-8" }), { json: true }, {})).toBeNull();
  });

  it("拒绝 text/plain 简单请求，不论来源", async () => {
    const res = guardApiRequest(req({ ...json, "content-type": "text/plain" }), { json: true }, {});
    expect(res?.status).toBe(415);
    expect((await res?.json())?.code).toBe("bad_request");
  });

  it("拒绝跨站 Origin、null Origin、Sec-Fetch-Site: cross-site", () => {
    expect(guardApiRequest(req({ ...json, origin: "https://evil.example" }), { json: true }, {})?.status).toBe(403);
    expect(guardApiRequest(req({ ...json, origin: "null" }), { json: true }, {})?.status).toBe(403);
    expect(guardApiRequest(req({ ...json, "sec-fetch-site": "cross-site" }), { json: true }, {})?.status).toBe(403);
    expect(guardApiRequest(req({ ...json, "sec-fetch-site": "same-site" }), { json: true }, {})?.status).toBe(403);
  });

  it("默认拒绝非回环 Host（局域网 / DNS rebinding），显式开关后放行", () => {
    const lan = { ...json, host: "192.168.1.20:3000" };
    expect(guardApiRequest(req(lan), { json: true }, {})?.status).toBe(403);
    expect(guardApiRequest(req({ ...json, host: "rebind.example:3000" }), { json: true }, {})?.status).toBe(403);
    expect(guardApiRequest(req(lan), { json: true }, { TAROT_ALLOW_LAN: "1" })).toBeNull();
    // 开启局域网后，Origin 仍须与 Host 一致
    expect(guardApiRequest(req({ ...lan, origin: "https://evil.example" }), { json: true }, { TAROT_ALLOW_LAN: "1" })?.status).toBe(403);
  });

  it("接受 127.0.0.1 与 [::1]", () => {
    expect(guardApiRequest(req({ ...json, host: "127.0.0.1:3211" }), { json: true }, {})).toBeNull();
    expect(guardApiRequest(req({ ...json, host: "[::1]:3211" }), { json: true }, {})).toBeNull();
  });

  it("GET（json: false）不要求 content-type", () => {
    expect(guardApiRequest(req({ host: "localhost:3000" }), { json: false }, {})).toBeNull();
  });
});
