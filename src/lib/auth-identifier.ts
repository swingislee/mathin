import { z } from "zod";

export type LoginIdentifier =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string };

export const emailLoginIdentifierSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export function normalizePhoneIdentifier(value: string) {
  let normalized = value.trim().replace(/[\s().-]/g, "");
  if (/^00[1-9]\d{7,14}$/.test(normalized)) normalized = `+${normalized.slice(2)}`;
  if (/^1[3-9]\d{9}$/.test(normalized)) normalized = `+86${normalized}`;
  if (/^861[3-9]\d{9}$/.test(normalized)) normalized = `+${normalized}`;
  return normalized;
}

export const phoneLoginIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform(normalizePhoneIdentifier)
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/));

export const loginIdentifierSchema = z.string().trim().min(1).max(254).transform((value, context): LoginIdentifier => {
  if (value.includes("@")) {
    const parsed = emailLoginIdentifierSchema.safeParse(value);
    if (parsed.success) return { kind: "email", value: parsed.data };
  } else {
    const parsed = phoneLoginIdentifierSchema.safeParse(value);
    if (parsed.success) return { kind: "phone", value: parsed.data };
  }
  context.addIssue({ code: "custom", message: "INVALID_LOGIN_IDENTIFIER" });
  return z.NEVER;
});
