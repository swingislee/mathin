import "server-only";

import type { User } from "@supabase/supabase-js";
import type { Profile, ProfileRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ConsentKind = "privacy" | "children_privacy";
export type ConsentDecision = "granted" | "withdrawn" | null;
export type AccountRequestKind = "access" | "correct" | "export" | "restrict" | "delete";

export interface AccountSecuritySnapshot {
  accountStatus: "active" | "locked";
  hasCurrentRequiredConsents: boolean;
  policies: Array<{
    kind: ConsentKind;
    version: string;
    effectiveAt: string;
    documentPath: string;
    decision: ConsentDecision;
  }>;
  requests: Array<{
    id: string;
    kind: AccountRequestKind;
    status: string;
    identityVerification: string;
    dataScope: string;
    dueAt: string;
    createdAt: string;
  }>;
  exports: Array<{
    id: string;
    requestId: string;
    schemaVersion: string;
    artifactHash: string;
    sizeBytes: number;
    expiresAt: string;
    createdAt: string;
    status: "ready" | "expired" | "purged";
    downloadCount: number;
  }>;
}

export type AccountIdentifierKind = "email" | "phone";
export type AccountIdentifierVerification = "unbound" | "unverified" | "invite_attested" | "provider_verified";

export interface AccountCenterSnapshot extends AccountSecuritySnapshot {
  profile: {
    userId: string;
    accountId: string;
    displayName: string;
    avatarUrl: string | null;
    preferredLocale: "zh" | "en";
    role: ProfileRole;
    staffRoles: Array<{ key: string; name: string }>;
  };
  identifiers: Array<{
    kind: AccountIdentifierKind;
    maskedValue: string | null;
    verification: AccountIdentifierVerification;
    loginAvailable: boolean;
    recoveryAvailable: boolean;
  }>;
}

export interface AccountSupportTarget {
  userId: string;
  displayName: string;
  email: string;
  identity: "student" | "parent" | "staff" | "admin";
  accountStatus: "active" | "locked";
  mfaVerified: boolean;
}

export interface AccountSupportSnapshot {
  activeAdmins: number;
  adminsWithoutMfa: number;
  openRequests: Array<{
    id: string;
    userId: string;
    kind: AccountRequestKind;
    status: string;
    identityVerification: string;
    dataScope: string;
    dueAt: string;
    createdAt: string;
  }>;
  recentExports: Array<{
    id: string;
    requestId: string;
    userId: string;
    subjectRole: "student" | "parent" | "staff" | "admin";
    dataScope: "account" | "account_and_learning";
    artifactHash: string;
    sizeBytes: number;
    expiresAt: string;
    createdAt: string;
    status: "ready" | "expired" | "purged";
    downloadCount: number;
  }>;
  recentOperationalExports: Array<{
    id: string;
    exportKind: "solution_record_webp";
    resourceId: string;
    actorUserId: string;
    artifactHash: string;
    sizeBytes: number;
    downloadedAt: string;
  }>;
  recentAudits: Array<{
    id: string;
    actorUserId: string;
    targetUserId: string;
    actionType: string;
    result: string;
    createdAt: string;
  }>;
  pendingInvitations: Array<{
    id: string;
    identifierType: "email" | "phone";
    identifier: string;
    expiresAt: string;
    createdAt: string;
  }>;
}

export async function getAccountSecuritySnapshot(): Promise<AccountSecuritySnapshot> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_account_security_snapshot");
  if (error || !data) throw new Error(error?.message ?? "ACCOUNT_SECURITY_UNAVAILABLE");
  return data as unknown as AccountSecuritySnapshot;
}

function maskEmail(value: string) {
  const [local = "", domain = ""] = value.split("@");
  const visible = local.slice(0, 1);
  return `${visible}${"•".repeat(Math.max(4, Math.min(8, local.length - 1)))}@${domain}`;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return `•••• ${digits.slice(-4)}`;
}

function trustedAvatarUrl(value: string | null) {
  if (!value) return null;
  try {
    const storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    const avatar = new URL(value);
    return avatar.origin === storageOrigin && avatar.pathname.includes("/storage/v1/object/public/profile-avatars/")
      ? avatar.toString()
      : null;
  } catch {
    return null;
  }
}

export async function getAccountCenterSnapshot(user: User, profile: Profile): Promise<AccountCenterSnapshot> {
  const supabase = await createClient();
  const [securityResult, assuranceResult, staffRoleResult] = await Promise.all([
    supabase.rpc("get_my_account_security_snapshot"),
    supabase
      .from("account_identifier_assurances")
      .select("identifier_type,provider_verified")
      .eq("user_id", user.id)
      .returns<Array<{ identifier_type: AccountIdentifierKind; provider_verified: boolean }>>(),
    supabase
      .from("staff_role_members")
      .select("staff_roles(key,name)")
      .eq("user_id", user.id)
      .returns<Array<{ staff_roles: { key: string; name: string } | Array<{ key: string; name: string }> | null }>>(),
  ]);
  if (securityResult.error || !securityResult.data) {
    throw new Error(securityResult.error?.message ?? "ACCOUNT_SECURITY_UNAVAILABLE");
  }

  const assurances = assuranceResult.data ?? [];
  const verification = (kind: AccountIdentifierKind, value: string | null, confirmedAt?: string | null): AccountIdentifierVerification => {
    if (!value) return "unbound";
    const assurance = assurances.find((row) => row.identifier_type === kind);
    if (assurance) return assurance.provider_verified ? "provider_verified" : "invite_attested";
    return confirmedAt ? "provider_verified" : "unverified";
  };
  const emailVerification = verification("email", user.email ?? null, user.email_confirmed_at);
  const phoneVerification = verification("phone", user.phone ?? null, user.phone_confirmed_at);
  const staffRoles = (staffRoleResult.data ?? []).flatMap((row) => {
    if (Array.isArray(row.staff_roles)) return row.staff_roles;
    return row.staff_roles ? [row.staff_roles] : [];
  });

  return {
    ...(securityResult.data as unknown as AccountSecuritySnapshot),
    profile: {
      userId: user.id,
      accountId: user.id.slice(0, 8).toUpperCase(),
      displayName: profile.displayName,
      avatarUrl: trustedAvatarUrl(profile.avatarUrl),
      preferredLocale: profile.preferredLocale,
      role: profile.role,
      staffRoles,
    },
    identifiers: [
      {
        kind: "email",
        maskedValue: user.email ? maskEmail(user.email) : null,
        verification: emailVerification,
        loginAvailable: Boolean(user.email),
        recoveryAvailable: emailVerification === "provider_verified",
      },
      {
        kind: "phone",
        maskedValue: user.phone ? maskPhone(user.phone) : null,
        verification: phoneVerification,
        loginAvailable: Boolean(user.phone),
        // SMS auto-confirm/recovery is deliberately disabled in the current P0.
        recoveryAvailable: false,
      },
    ],
  };
}

export async function getAccountSupportSnapshot(): Promise<AccountSupportSnapshot> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_account_support_snapshot");
  if (error || !data) throw new Error(error?.message ?? "ACCOUNT_SUPPORT_UNAVAILABLE");
  return data as unknown as AccountSupportSnapshot;
}
