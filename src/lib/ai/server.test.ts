import { describe, expect, it } from "vitest";
import { resolveProviderConfig } from "./server";

describe("resolveProviderConfig", () => {
  it("没配置 → null（本地模式）", () => {
    expect(resolveProviderConfig({})).toBeNull();
    expect(resolveProviderConfig({ ANTHROPIC_API_KEY: "  ", OPENAI_API_KEY: "" })).toBeNull();
  });

  it("只有 Anthropic key → anthropic；两者都有时默认 anthropic，AI_PROVIDER 可指定", () => {
    expect(resolveProviderConfig({ ANTHROPIC_API_KEY: "a" })).toEqual({ kind: "anthropic", apiKey: "a" });
    const both = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", OPENAI_MODEL: "m" };
    expect(resolveProviderConfig(both)?.kind).toBe("anthropic");
    expect(resolveProviderConfig({ ...both, AI_PROVIDER: "openai-compatible" })?.kind).toBe("openai-compatible");
    expect(resolveProviderConfig({ ...both, AI_PROVIDER: "openai" })?.kind).toBe("openai-compatible");
  });

  it("OpenAI 兼容：key 与 model 必填；base URL 默认 OpenAI；deep 模型默认同 model；去掉末尾斜杠", () => {
    expect(resolveProviderConfig({ OPENAI_API_KEY: "o" })).toBeNull(); // 缺 model
    expect(resolveProviderConfig({ OPENAI_MODEL: "m" })).toBeNull(); // 缺 key
    expect(resolveProviderConfig({ OPENAI_API_KEY: "o", OPENAI_MODEL: "m" })).toMatchObject({ kind: "openai-compatible", baseURL: "https://api.openai.com/v1", model: "m", modelDeep: "m", jsonMode: "json_object" });
    expect(resolveProviderConfig({ OPENAI_API_KEY: "o", OPENAI_MODEL: "fast", OPENAI_MODEL_DEEP: "big", OPENAI_BASE_URL: "https://api.deepseek.com/", OPENAI_TEMPERATURE: "0.3", OPENAI_JSON_MODE: "json_schema" })).toMatchObject({
      baseURL: "https://api.deepseek.com",
      modelDeep: "big",
      temperature: 0.3,
      jsonMode: "json_schema",
    });
  });

  it("配置不合法 → null：坏 URL、显式指定 anthropic 却没有 key、temperature 非数字被忽略", () => {
    expect(resolveProviderConfig({ OPENAI_API_KEY: "o", OPENAI_MODEL: "m", OPENAI_BASE_URL: "not a url" })).toBeNull();
    expect(resolveProviderConfig({ AI_PROVIDER: "anthropic", OPENAI_API_KEY: "o", OPENAI_MODEL: "m" })).toBeNull();
    expect(resolveProviderConfig({ OPENAI_API_KEY: "o", OPENAI_MODEL: "m", OPENAI_TEMPERATURE: "abc" })).toMatchObject({ temperature: undefined });
  });
});
