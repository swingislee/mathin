import { z } from "zod";
import { familyChildSchema } from "@/features/parent-portal/onboarding-contract";
import { formQuestionsSchema, questionAnswersSchema } from "@/features/parent-portal/form-questions";

export const promotionSchema = z.object({ scene: z.string(), name: z.string(), enabled: z.boolean(), updatedAt: z.string(), newCount: z.number(), repeatCount: z.number() });
export const promotionSettingsSchema = z.array(promotionSchema);
export type PromotionSettings = z.infer<typeof promotionSettingsSchema>;
export const promotionRecordSchema = z.object({ id: z.string(), at: z.string(), promoter: z.string(), state: z.enum(["new", "existing_record", "registered"]),
  questions: formQuestionsSchema.default([]), extraAnswers: questionAnswersSchema.default({}),
  phone: z.string().nullable(), parentName: z.string().nullable(), childName: z.string().nullable(), grade: z.string().nullable(), school: z.string().nullable(),
  interests: z.array(z.string()).nullable(), location: z.object({ status: z.string(), latitude: z.number().optional(), longitude: z.number().optional(), accuracy: z.number().nullable().optional(),
    enteredAt: z.string().optional(), capturedAt: z.string().optional() }).nullable(),
  studentId: z.string().nullable(), leadId: z.string().nullable(), registrationId: z.string().nullable(),
  children: z.array(familyChildSchema), interestOptions: z.array(z.object({ id: z.string(), label: z.object({ zh: z.string(), en: z.string() }) })),
  participants: z.array(z.object({ key: z.string(), studentId: z.string(), name: z.string(), grade: z.number().nullable(), school: z.string(), gender: z.string(), parentName: z.string() })),
  verifiedAt: z.string().nullable(), verifiedBy: z.string().nullable(), canVerify: z.boolean(), canAddChild: z.boolean() });
export const promotionDashboardSchema = z.object({ promotions: z.array(promotionSchema), records: z.array(promotionRecordSchema), total: z.number() });
export type PromotionDashboard = z.infer<typeof promotionDashboardSchema>;
export type PromotionRecord = z.infer<typeof promotionRecordSchema>;
export const verifiedFamilySchema = z.object({ parentName: z.string().trim().max(100),
  children: z.array(familyChildSchema.extend({ childName: z.string().trim().min(1).max(100) })).min(1).max(10)
    .refine(children => new Set(children.map(child => child.key)).size === children.length),
}).strict();
export type VerifiedFamily = z.infer<typeof verifiedFamilySchema>;
