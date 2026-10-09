# Prompt v4（2026-10-09）

相对 v3：在 `reading-system.md` 与 `perspective-system.md` 末尾增加**输出示例**和“只能有这些键”的明确清单。
目的：产品支持各种模型（OpenAI 兼容接口通常只保证 JSON，不保证按 schema），示例 + 清单显著减少多余字段 / 嵌套数组这类格式偏差。
`rewrite-system.md` 不变。业务层另有无损容错与一次重试（`model-output.ts`），但 prompt 仍应让模型第一次就写对。
