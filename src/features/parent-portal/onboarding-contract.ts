import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
export const promotionSceneSchema = z.string().regex(/^[a-f0-9]{24}$/);
export const registrationLocationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("granted"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).nullable() }).strict(),
  z.object({ status: z.enum(["declined", "unavailable"]) }).strict(),
]);
export const familyRegistrationSchema = z.object({
  parentName: text(100), relation: z.enum(["mother", "father", "guardian"]),
  childName: text(100), gender: z.enum(["", "female", "male"]), grade: z.number().int().min(-1).max(12),
  school: z.string().trim().max(120), interests: z.array(z.enum(["math", "science", "activities"])).min(1).max(3),
  location: registrationLocationSchema,
  privacyVersion: text(40), childrenPrivacyVersion: text(40), consent: z.literal(true),
}).strict();
export const onboardingCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("phone"), ticket: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).strict(),
  z.object({ action: z.literal("complete"), ticket: z.string().regex(/^[a-f0-9]{64}$/), family: familyRegistrationSchema }).strict(),
]);
export type FamilyRegistration = z.infer<typeof familyRegistrationSchema>;
