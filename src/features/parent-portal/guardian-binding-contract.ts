import { z } from "zod";

export const guardianInviteCode = z.string().regex(/^[a-f0-9]{32}$/);
const ticket = z.string().regex(/^[a-f0-9]{64}$/);
const wechatCode = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
export const guardianConfirmation = z.object({
  parentName: z.string().trim().min(1).max(100), relation: z.enum(["mother", "father", "guardian"]),
  consent: z.literal(true), privacyVersion: z.string().min(1).max(100), childrenPrivacyVersion: z.string().min(1).max(100),
}).strict();
export const guardianBindingCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), invitation: guardianInviteCode }).strict(),
  z.object({ action: z.literal("login"), invitation: guardianInviteCode, code: wechatCode }).strict(),
  z.object({ action: z.literal("phone"), ticket, code: wechatCode }).strict(),
  z.object({ action: z.literal("confirm"), ticket, confirmation: guardianConfirmation }).strict(),
]);
