import { z } from "zod";
import { FAMILY_FIELD_IDS } from "../../../contracts/participant-api/onboarding";

const clean = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const label = z.object({ zh: clean(100), en: z.string().trim().max(160) }).strict();
const option = z.object({ id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/), label }).strict();
export const familyFieldSchema = z.object({
  id: z.enum(["parentName", "relation", "childName", "grade", "school", "gender", "interests"]),
  mode: z.enum(["required", "optional", "hidden"]), label,
  options: z.array(option).min(1).max(20).optional(),
}).strict().refine(field => field.id === "interests" ? Boolean(field.options?.length)
  && new Set(field.options!.map(value => value.id)).size === field.options!.length : field.options === undefined);
export const familyFormConfigSchema = z.object({
  title: label,
  description: z.object({ zh: z.string().trim().max(400), en: z.string().trim().max(600) }).strict(),
  fields: z.array(familyFieldSchema).length(FAMILY_FIELD_IDS.length)
    .refine(fields => new Set(fields.map(field => field.id)).size === FAMILY_FIELD_IDS.length),
}).strict();
export const familyFormSchema = familyFormConfigSchema.extend({ slug: z.string(), version: z.number().int().positive() });
