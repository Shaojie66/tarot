# Prompt v5（2026-10-10）

相对 v4：`reading-system.md` 与 `perspective-system.md` 增加“用户这次想要的帮助”一节（理清处境 / 做个决定 / 只是陪我说说话），
对应用户消息里可选的“这次想要的帮助”一行（`src/features/reading/prompts.ts`）。语气随之变化，但原则不变：
不预测、不替用户做决定或确认处境 / 他人动机、不用断言式用语。`rewrite-system.md` 不变。
