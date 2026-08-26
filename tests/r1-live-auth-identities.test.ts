import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  emailLoginIdentifierSchema,
  loginIdentifierSchema,
  phoneLoginIdentifierSchema,
} from "@/lib/auth-identifier";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("R1-Live email and phone password identities", () => {
  it("normalizes email and mainland-China/E.164 phone identifiers", () => {
    expect(emailLoginIdentifierSchema.parse(" Teacher@Example.COM ")).toBe("teacher@example.com");
    expect(phoneLoginIdentifierSchema.parse("138 0000 0000")).toBe("+8613800000000");
    expect(phoneLoginIdentifierSchema.parse("0086-139-0000-0000")).toBe("+8613900000000");
    expect(phoneLoginIdentifierSchema.parse("+1 (415) 555-2671")).toBe("+14155552671");
    expect(phoneLoginIdentifierSchema.safeParse("12345").success).toBe(false);
    expect(loginIdentifierSchema.parse("13800000000")).toEqual({ kind: "phone", value: "+8613800000000" });
    expect(loginIdentifierSchema.parse("teacher@example.com")).toEqual({ kind: "email", value: "teacher@example.com" });
  });

  it("uses one password form and keeps unavailable OTP registration out of the UI", () => {
    const actions = read("src/app/[locale]/(auth)/actions.ts");
    const form = read("src/components/auth-form.tsx");
    const phoneRoute = read("src/app/[locale]/(auth)/login/phone/page.tsx");
    expect(actions).toContain('signInWithPassword(credentials)');
    expect(actions).toContain('rpc("validate_registration_access_v2"');
    expect(actions).toContain("admin.auth.admin.createUser");
    expect(actions).toContain("phone_confirm: true");
    expect(form).toContain('id="username" name="username"');
    expect(form).toContain('autoComplete="username"');
    expect(form).toContain('autoComplete={mode === "login" ? "current-password" : "new-password"}');
    expect(actions).toContain('formData.get("username")');
    expect(actions).not.toContain('formData.get("identifier")');
    expect(form).toContain('name="passwordConfirm"');
    expect(form).not.toContain("phoneLogin");
    expect(phoneRoute).toContain("redirect(`/${locale}/login`)");
    expect(actions).not.toContain("signInWithOtp");
  });

  it("keeps phone signup staff-invite-only and records provider-unverified assurance", () => {
    const migration = read("supabase/migrations/20260825000600_r1_live_phone_password_auth.sql");
    expect(migration).toContain("issue_staff_identity_invitation");
    expect(migration).toContain("validate_registration_access_v2");
    expect(migration).toMatch(/clean_type = 'email' and exists\([\s\S]*registration_invite_settings/);
    expect(migration).toContain("account_identifier_assurances");
    expect(migration).toContain("provider_verified boolean not null default false");
    expect(migration).toContain("auth.users/auth.identities remain the login identity authority");
  });
});
