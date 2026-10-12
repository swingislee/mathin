import { z } from "zod";
import type { ActivityPage } from "../../../../contracts/participant-api/activity-detail";
import { registrationIdSchema } from "@/features/parent-portal/course-contract";

export const activityImagePath = /^(activity|class)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const imagePath = z.string().max(120).refine(v => !v || activityImagePath.test(v));
const title = z.string().max(120), body = z.string().max(6000);
export const activityPageSchema: z.ZodType<ActivityPage> = z.object({
  version: z.literal(1), layout: z.enum(["cards", "continuous"]), cover: imagePath,
  blocks: z.discriminatedUnion("type", [
    z.object({ id: registrationIdSchema, type: z.literal("text"), title, body }).strict(),
    z.object({ id: registrationIdSchema, type: z.literal("image"), imagePath, caption: z.string().max(300) }).strict(),
    z.object({ id: registrationIdSchema, type: z.literal("imageText"), imagePath, title, body,
      position: z.enum(["above", "left", "right"]) }).strict(),
  ]).array().max(30).refine(blocks => new Set(blocks.map(b => b.id)).size === blocks.length),
}).strict();
export const activityPageTargetSchema = z.object({ kind: z.enum(["activity", "class"]), targetId: registrationIdSchema });
export type ActivityPageTarget = z.infer<typeof activityPageTargetSchema>;
export const activityPageStateSchema = z.object({
  draft: activityPageSchema.nullable(), revision: z.number().int().nonnegative(),
  publishedRevision: z.number().int().positive().nullable(), publishedAt: z.string().nullable(),
});
export type ActivityPageState = z.infer<typeof activityPageStateSchema>;
export function pageImagePaths(page: ActivityPage) {
  return [page.cover, ...page.blocks.flatMap(b => b.type === "text" ? [] : [b.imagePath])].filter(Boolean);
}
