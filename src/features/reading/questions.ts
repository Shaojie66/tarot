import { z } from "zod";
import data from "../../../content/questions.json";

const question = z.string().trim().min(4).endsWith("？");
const topic = z.strictObject({ label: z.string(), hint: z.string(), examples: z.array(question).min(4) });

const questionBankSchema = z.strictObject({
  topics: z.strictObject({ career: topic, relationship: topic, self: topic, crossroads: topic }),
  unsure: z.strictObject({ label: z.string(), prompts: z.array(question).min(1) }),
});

/** 示例问题库，加载时校验；主题键与 TOPICS 的一致性由测试保证。 */
export const QUESTION_BANK = questionBankSchema.parse(data);
