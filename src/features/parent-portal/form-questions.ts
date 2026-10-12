import { z } from "zod";
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/).refine(v => !["constructor", "prototype", "__proto__"].includes(v));
const label = z.object({ zh: z.string().trim().min(1).max(100), en: z.string().trim().max(160) }).strict();
export const formQuestionSchema = z.object({ id, type: z.enum(["text", "phone", "textarea", "select", "multiselect"]), label,
  required: z.boolean(), options: z.array(z.object({ id, label }).strict()).min(1).max(20).optional() }).strict()
  .refine(f => ["select", "multiselect"].includes(f.type) ? !!f.options?.length && new Set(f.options.map(o => o.id)).size === f.options.length : f.options === undefined);
export const formQuestionsSchema = z.array(formQuestionSchema).max(20).refine(v => new Set(v.map(f => f.id)).size === v.length);
export const questionAnswersSchema = z.record(id, z.union([z.string().max(2000), z.array(id).max(20)]))
  .refine(v => Object.keys(v).length <= 20 && new TextEncoder().encode(JSON.stringify(v)).length <= 20000);
