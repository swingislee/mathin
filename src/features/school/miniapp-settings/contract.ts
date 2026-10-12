import { z } from "zod";
import { reportTemplatesSchema } from "./report-contract";
import { miniappActions, miniappIcons, type MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";

export const miniappAssetPath = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
export const miniappLocalized = (limit: number) => z.object({ zh: z.string().max(limit), en: z.string().max(limit) }).strict();
export const bookingPolicySchema = z.object({ windowDays: z.number().int().min(1).max(56),
  modes: z.array(z.enum(["campus", "online"])).min(1).max(2).refine(v => new Set(v).size === v.length),
  bookingCutoffMinutes: z.number().int().min(0).max(10080), selfCancellation: z.boolean(),
  cancellationCutoffMinutes: z.number().int().min(0).max(10080), instructions: miniappLocalized(2000),
}).strict();
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), target = z.string().regex(/^[a-zA-Z0-9_-]{0,64}$/);
const image = z.string().refine(v => !v || miniappAssetPath.test(v));
const unique = <T extends { id: string }>(rows: T[]) => new Set(rows.map(r => r.id)).size === rows.length;
export const contactImagePath = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp|-?\d{1,2}\/[0-9a-f-]{36}\.(?:png|jpg|webp))$/;
export const miniappContactSchema = z.object({ id, name: miniappLocalized(60), service: miniappLocalized(120),
  phone: z.string().regex(/^(?:|\+?\d[\d -]{5,23})$/), qrImage: z.string().refine(v => !v || contactImagePath.test(v)),
  stageNumbers: z.array(z.number().int().min(-1).max(12)).max(14).refine(v => new Set(v).size === v.length),
  campusId: z.union([z.literal(""), z.string().uuid()]), hours: miniappLocalized(500), address: miniappLocalized(500), visible: z.boolean(),
}).strict().refine(v => !v.visible || !!(v.phone || v.qrImage));
const entry = z.object({ id, title: miniappLocalized(60), action: z.enum(miniappActions), target,
  icon: z.enum(miniappIcons), visible: z.boolean(), audience: z.enum(["all", "signedIn", "participants"]) }).strict();
export const miniappSettingsSchema: z.ZodType<MiniappSettings> = z.object({
  version: z.literal(1),
  booking: bookingPolicySchema.optional(),
  contacts: z.array(miniappContactSchema).max(40).refine(unique).optional(),
  reports: reportTemplatesSchema.optional(),
  brand: z.object({ name: miniappLocalized(60), introduction: miniappLocalized(500), image, theme: z.enum(["paper", "leaf", "rose"]) }).strict(),
  home: z.array(z.object({ id, type: z.enum(["feature", "activities", "text", "image"]), visible: z.boolean(),
    title: miniappLocalized(120), body: miniappLocalized(2000), image, action: z.enum(miniappActions), target,
    limit: z.number().int().min(1).max(12), featuredIds: z.array(z.string().uuid()).max(30) }).strict()).max(12).refine(unique),
  floating: z.array(entry).max(5).refine(unique),
  accountGroups: z.array(z.object({ id, title: miniappLocalized(60), entries: z.array(entry).max(20).refine(unique) }).strict()).max(8).refine(unique),
  stages: z.array(z.object({ id, label: miniappLocalized(60), stages: z.array(z.object({ id,
    stageNumber: z.number().int().min(-1).max(12), label: miniappLocalized(60), visible: z.boolean() }).strict()).max(14) }).strict()).min(1).max(14).refine(groups => {
      const stages = groups.flatMap(g => g.stages);
      return unique(groups) && stages.length === 14 && new Set(stages.map(s => s.stageNumber)).size === 14
        && stages.every(s => s.id === (s.stageNumber < 1 ? `k${s.stageNumber + 3}` : `g${s.stageNumber}`));
    }),
}).strict().refine(v => new TextEncoder().encode(JSON.stringify(v)).length <= 64 * 1024);

export const settingsStateSchema = z.object({ draft: miniappSettingsSchema.nullable(), revision: z.number().int().nonnegative(),
  publishedRevision: z.number().int().positive().nullable(), publishedAt: z.string().nullable(),
  history: z.array(z.object({ revision: z.number().int().positive(), publishedAt: z.string() })).max(50),
});
export type SettingsState = z.infer<typeof settingsStateSchema>;
export function settingsImagePaths(config: MiniappSettings): string[] { return [config.brand.image, ...config.home.map(b => b.image), ...(config.contacts || []).map(c => c.qrImage).filter(p => !p.includes("/"))].filter(Boolean); }
