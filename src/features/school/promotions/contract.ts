import { z } from "zod";

export const promotionSchema = z.object({ scene: z.string(), name: z.string(), enabled: z.boolean(), updatedAt: z.string(), newCount: z.number(), repeatCount: z.number() });
export const promotionRecordSchema = z.object({ id: z.string(), at: z.string(), promoter: z.string(), state: z.enum(["new", "existing_record", "registered"]),
  phone: z.string().nullable(), parentName: z.string().nullable(), childName: z.string().nullable(), grade: z.string().nullable(), school: z.string().nullable(),
  interests: z.array(z.string()).nullable(), location: z.object({ status: z.string(), latitude: z.number().optional(), longitude: z.number().optional(), accuracy: z.number().nullable().optional() }).nullable(),
  studentId: z.string().nullable(), leadId: z.string().nullable() });
export const promotionDashboardSchema = z.object({ promotions: z.array(promotionSchema), records: z.array(promotionRecordSchema), total: z.number() });
export type PromotionDashboard = z.infer<typeof promotionDashboardSchema>;
