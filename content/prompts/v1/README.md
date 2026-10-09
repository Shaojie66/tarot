# Prompt v1（2026-10-09）

- `reading-system.md`：三张牌解读的系统提示。用户消息由 `src/features/reading/prompts.ts` 按牌阵、牌义、问题拼装。
- `rewrite-system.md`：问题改写的系统提示。

输出都用 JSON Schema 结构化（schema 在 `src/features/reading/ai.ts`），并带 `crisis` 标记作为第二层安全检查。
改 prompt 时新建 `v2/`，不要原地修改；改完跑 `pnpm test`（mock 评测）和 `pnpm eval:live`（需要 key）。
