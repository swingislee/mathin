import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
export const promotionSceneSchema = z.string().regex(/^[a-f0-9]{24}$/);
const optionalText = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const childFields = {
  childName: optionalText(100), gender: z.enum(["", "female", "male"]), grade: z.number().int().min(-1).max(12).nullable(),
  school: optionalText(120), interests: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/)).max(20)
    .refine(values => new Set(values).size === values.length),
};
export const familyChildSchema = z.object({ key: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/), participantId: z.string().uuid().optional(), ...childFields }).strict();
const locationTime = { enteredAt: z.string().datetime().optional(), capturedAt: z.string().datetime().optional() };
export const registrationLocationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("granted"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).nullable(), ...locationTime }).strict(),
  z.object({ status: z.enum(["declined", "unavailable"]), ...locationTime }).strict(),
]);
export const familyRegistrationSchema = z.object({
  parentName: optionalText(100), relation: z.enum(["", "mother", "father", "guardian"]), ...childFields,
  children: z.array(familyChildSchema).min(1).max(10).refine(children => new Set(children.map(child => child.key)).size === children.length).optional(),
  formVersion: z.number().int().positive().optional(),
  location: registrationLocationSchema,
  privacyVersion: text(40), childrenPrivacyVersion: text(40), consent: z.literal(true),
}).strict();
export const onboardingCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("phone"), ticket: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/) }).strict(),
  z.object({ action: z.literal("form"), ticket: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("complete"), ticket: z.string().regex(/^[a-f0-9]{64}$/), family: familyRegistrationSchema }).strict(),
]);
export type FamilyRegistration = z.infer<typeof familyRegistrationSchema>;
