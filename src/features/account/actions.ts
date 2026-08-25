"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { emailLoginIdentifierSchema, phoneLoginIdentifierSchema } from "@/lib/auth-identifier";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, requiredText, text, uuid } from "@/features/school/actions/schemas";
import type { AccountSupportTarget } from "./account-security";

const consentSchema = z.object({
  policyKind: z.enum(["privacy", "children_privacy"]),
  decision: z.enum(["granted", "withdrawn"]),
});
const rightsRequestSchema = z.object({
  kind: z.enum(["access", "correct", "export", "restrict", "delete"]),
  reason: text(1000),
  dataScope: requiredText(200),
});
const supportTargetSchema = z.object({ target: uuid, reason: requiredText(500) });
const staffInviteSchema = z.discriminatedUnion("identifierType", [
  z.object({ identifierType: z.literal("email"), identifier: emailLoginIdentifierSchema, validDays: z.number().int().min(1).max(30) }),
  z.object({ identifierType: z.literal("phone"), identifier: phoneLoginIdentifierSchema, validDays: z.number().int().min(1).max(30) }),
]);
const requestDecisionSchema = z.object({
  requestId: uuid,
  status: z.enum(["submitted", "identity_verified", "approved", "processing", "completed", "rejected", "cancelled"]),
  identityVerification: z.enum(["pending", "verified", "rejected"]),
  decisionReason: text(1000),
  resultSummary: text(2000),
  evidenceHash: z.union([z.literal(""), z.string().regex(/^[a-f0-9]{64}$/)]),
});
const exportArtifactSchema = z.object({ artifactId: uuid });
const accountProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  preferredLocale: z.enum(["zh", "en"]),
  avatarPath: z.union([
    z.null(),
    z.string().max(200).regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/),
  ]).optional(),
});

export interface AccountProfileUpdate {
  displayName: string;
  avatarUrl: string | null;
  preferredLocale: "zh" | "en";
}

export interface PreparedUserRightsExport {
  artifactId: string;
  artifactHash: string;
  sizeBytes: number;
  expiresAt: string;
  subjectRole: "student" | "parent" | "staff" | "admin";
  dataScope: "account" | "account_and_learning";
}

export interface UserRightsExportDownload {
  fileName: string;
  artifactHash: string;
  contentText: string;
  expiresAt: string;
}

const SELF_CODES = [
  "INVALID_DECISION", "POLICY_NOT_FOUND", "REQUEST_ALREADY_OPEN", "INVALID_KIND", "INVALID_SCOPE",
  "EXPORT_NOT_FOUND", "EXPORT_EXPIRED", "EXPORT_PURGED", "EXPORT_HASH_MISMATCH", ...COMMON_CODES,
  "AVATAR_PATH_INVALID", "PROFILE_UPDATE_FAILED",
];
const SUPPORT_CODES = [
  "TARGET_NOT_FOUND", "LAST_ACTIVE_ADMIN", "INVALID_ACTION", "INVALID_REASON", "INVALID_STATUS",
  "IDENTITY_NOT_VERIFIED", "EVIDENCE_REQUIRED", "EXPORT_ARTIFACT_REQUIRED", "REQUEST_NOT_APPROVED",
  "EXPORT_TOO_LARGE", "INVALID_SCOPE", "REQUEST_NOT_FOUND", "REQUEST_TERMINAL",
  "ACCOUNT_EXISTS", "INVITATION_ALREADY_PENDING", "INVITATION_NOT_PENDING", "INVALID_IDENTIFIER_TYPE",
  "INVALID_EMAIL", "INVALID_PHONE", "INVALID_EXPIRY",
  ...COMMON_CODES,
];

function correlationHash(target: string, action: string) {
  return createHash("sha256").update(`${target}:${action}:${Date.now()}`).digest("hex");
}

function profileAvatarPath(publicUrl: string | null, userId: string) {
  if (!publicUrl) return null;
  try {
    const marker = "/storage/v1/object/public/profile-avatars/";
    const pathname = new URL(publicUrl).pathname;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const path = decodeURIComponent(pathname.slice(markerIndex + marker.length));
    return path.startsWith(`${userId}/`) ? path : null;
  } catch {
    return null;
  }
}

export async function updateAccountProfileAction(input: unknown): Promise<ActionResult<AccountProfileUpdate>> {
  try {
    const value = parse(accountProfileSchema, input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const hasAvatarUpdate = Object.prototype.hasOwnProperty.call(value, "avatarPath");
    if (typeof value.avatarPath === "string" && !value.avatarPath.startsWith(`${user.id}/`)) {
      throw new Error("AVATAR_PATH_INVALID");
    }

    const { data: current, error: currentError } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .single<{ avatar_url: string | null }>();
    if (currentError || !current) throw new Error("PROFILE_UPDATE_FAILED");

    let avatarUrl = current.avatar_url;
    if (hasAvatarUpdate) {
      avatarUrl = value.avatarPath
        ? supabase.storage.from("profile-avatars").getPublicUrl(value.avatarPath).data.publicUrl
        : null;
    }
    const update: {
      display_name: string;
      preferred_locale: "zh" | "en";
      avatar_url?: string | null;
    } = {
      display_name: value.displayName,
      preferred_locale: value.preferredLocale,
    };
    if (hasAvatarUpdate) update.avatar_url = avatarUrl;
    const { error: updateError } = await supabase.from("profiles").update(update).eq("id", user.id);
    if (updateError) throw new Error("PROFILE_UPDATE_FAILED");

    const previousPath = profileAvatarPath(current.avatar_url, user.id);
    if (hasAvatarUpdate && previousPath && previousPath !== value.avatarPath) {
      await supabase.storage.from("profile-avatars").remove([previousPath]);
    }
    revalidatePath("/[locale]/dashboard/account-security", "page");
    return {
      ok: true,
      data: {
        displayName: value.displayName,
        avatarUrl,
        preferredLocale: value.preferredLocale,
      },
    };
  } catch (error) {
    return actionError<AccountProfileUpdate>(error, SELF_CODES, "PROFILE_UPDATE_FAILED");
  }
}

export async function recordAccountConsentAction(input: unknown): Promise<ActionResult> {
  try {
    const value = parse(consentSchema, input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { error } = await supabase.rpc("record_account_consent", { p_policy_kind: value.policyKind, p_decision: value.decision });
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard/account-security", "page");
    return { ok: true };
  } catch (error) {
    return actionError(error, SELF_CODES);
  }
}

export async function requestUserRightAction(input: unknown): Promise<ActionResult<{ requestId: string }>> {
  try {
    const value = parse(rightsRequestSchema, input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { data, error } = await supabase.rpc("request_account_action", {
      p_kind: value.kind,
      p_reason: value.reason,
      p_data_scope: value.dataScope,
    });
    if (error || !data) throw new Error(error?.message ?? "REQUEST_FAILED");
    revalidatePath("/[locale]/dashboard/account-security", "page");
    return { ok: true, data: { requestId: data } };
  } catch (error) {
    return actionError<{ requestId: string }>(error, SELF_CODES, "REQUEST_FAILED");
  }
}

export async function lookupAccountSupportTargetAction(email: string): Promise<ActionResult<AccountSupportTarget | null>> {
  try {
    const normalized = parse(z.email().max(254).transform((value) => value.toLowerCase()), email.trim());
    const { supabase } = await authorizedClient("account.support.manage");
    const { data, error } = await supabase.rpc("lookup_account_support_target", { p_email: normalized });
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as {
      user_id: string; display_name: string; email: string; identity: AccountSupportTarget["identity"];
      account_status: AccountSupportTarget["accountStatus"]; mfa_verified: boolean;
    } | undefined;
    return { ok: true, data: row ? {
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      identity: row.identity,
      accountStatus: row.account_status,
      mfaVerified: row.mfa_verified,
    } : null };
  } catch (error) {
    return actionError<AccountSupportTarget | null>(error, SUPPORT_CODES);
  }
}

async function recordSupportResult(target: string, action: "ban" | "restore" | "recovery_requested", reason: string, result: "succeeded" | "failed") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_account_support_action", {
    p_target: target,
    p_action_type: action,
    p_reason: reason,
    p_result: result,
    p_correlation_hash: correlationHash(target, action),
  });
  if (error) throw new Error(error.message);
}

export async function setAccountLockAction(target: string, locked: boolean, reason: string): Promise<ActionResult> {
  try {
    const value = parse(supportTargetSchema, { target, reason });
    const { supabase } = await authorizedClient("account.support.manage");
    const { error: preflightError } = await supabase.rpc("assert_account_support_target", { p_target: value.target, p_locking: locked });
    if (preflightError) throw new Error(preflightError.message);
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(value.target, { ban_duration: locked ? "876000h" : "none" });
    await recordSupportResult(value.target, locked ? "ban" : "restore", value.reason, error ? "failed" : "succeeded");
    if (error) throw new Error("AUTH_PROVIDER_FAILED");
    revalidatePath("/[locale]/dashboard/account-support", "page");
    return { ok: true };
  } catch (error) {
    return actionError(error, [...SUPPORT_CODES, "AUTH_PROVIDER_FAILED"]);
  }
}

export async function revokeUserSessionsAction(target: string, reason: string): Promise<ActionResult<{ sessions: number }>> {
  try {
    const value = parse(supportTargetSchema, { target, reason });
    const { supabase } = await authorizedClient("account.support.manage");
    const { data, error } = await supabase.rpc("revoke_user_sessions", { p_target: value.target, p_reason: value.reason });
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard/account-support", "page");
    return { ok: true, data: { sessions: Number(data ?? 0) } };
  } catch (error) {
    return actionError<{ sessions: number }>(error, SUPPORT_CODES);
  }
}

export async function sendRecoveryAction(target: string, reason: string, locale: string): Promise<ActionResult> {
  try {
    const value = parse(supportTargetSchema.extend({ locale: z.enum(["zh", "en"]) }), { target, reason, locale });
    await authorizedClient("account.support.manage");
    const admin = createAdminClient();
    const { data, error: lookupError } = await admin.auth.admin.getUserById(value.target);
    const email = data.user?.email;
    if (lookupError || !email) throw new Error("TARGET_NOT_FOUND");
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) throw new Error("AUTH_PROVIDER_FAILED");
    const next = encodeURIComponent(`/${value.locale}/dashboard/account-security?recovery=1`);
    const { error } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/${value.locale}/auth/callback?next=${next}`,
    });
    await recordSupportResult(value.target, "recovery_requested", value.reason, error ? "failed" : "succeeded");
    if (error) throw new Error("AUTH_PROVIDER_FAILED");
    return { ok: true };
  } catch (error) {
    return actionError(error, [...SUPPORT_CODES, "AUTH_PROVIDER_FAILED"]);
  }
}

export async function issueStaffInvitationAction(
  identifierType: "email" | "phone",
  identifier: string,
  validDays = 7,
): Promise<ActionResult<{ invitationId: string; inviteCode: string; expiresAt: string }>> {
  try {
    const value = parse(staffInviteSchema, { identifierType, identifier, validDays });
    const { supabase } = await authorizedClient("staff.manage");
    const { data, error } = await supabase.rpc("issue_staff_identity_invitation", {
      p_identifier_type: value.identifierType,
      p_identifier: value.identifier,
      p_valid_days: value.validDays,
    });
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as { invitation_id: string; invite_code: string; expires_at: string } | undefined;
    if (!row) throw new Error("INVITATION_FAILED");
    revalidatePath("/[locale]/dashboard/account-support", "page");
    return { ok: true, data: { invitationId: row.invitation_id, inviteCode: row.invite_code, expiresAt: row.expires_at } };
  } catch (error) {
    return actionError<{ invitationId: string; inviteCode: string; expiresAt: string }>(error, SUPPORT_CODES, "INVITATION_FAILED");
  }
}

export async function revokeStaffInvitationAction(invitationId: string, reason: string): Promise<ActionResult> {
  try {
    const value = parse(z.object({ invitationId: uuid, reason: requiredText(500) }), { invitationId, reason });
    const { supabase } = await authorizedClient("staff.manage");
    const { error } = await supabase.rpc("revoke_staff_invitation", { p_invitation_id: value.invitationId, p_reason: value.reason });
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard/account-support", "page");
    return { ok: true };
  } catch (error) {
    return actionError(error, SUPPORT_CODES);
  }
}

export async function manageAccountRequestAction(input: unknown): Promise<ActionResult> {
  try {
    const value = parse(requestDecisionSchema, input);
    const { supabase } = await authorizedClient("account.support.manage");
    const { error } = await supabase.rpc("manage_account_request", {
      p_request_id: value.requestId,
      p_status: value.status,
      p_identity_verification: value.identityVerification,
      p_decision_reason: value.decisionReason || undefined,
      p_result_summary: value.resultSummary || undefined,
      p_evidence_hash: value.evidenceHash || undefined,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard/account-support", "page");
    return { ok: true };
  } catch (error) {
    return actionError(error, SUPPORT_CODES);
  }
}

export async function prepareUserRightsExportAction(input: unknown): Promise<ActionResult<PreparedUserRightsExport>> {
  try {
    const requestId = parse(z.object({ requestId: uuid }), { requestId: input }).requestId;
    const { supabase } = await authorizedClient("account.support.manage");
    const { data, error } = await supabase.rpc("prepare_user_rights_export", { p_request_id: requestId });
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as {
      artifact_id: string;
      artifact_hash: string;
      size_bytes: number;
      expires_at: string;
      subject_role: PreparedUserRightsExport["subjectRole"];
      data_scope: PreparedUserRightsExport["dataScope"];
    } | undefined;
    if (!row) throw new Error("EXPORT_PREPARE_FAILED");
    revalidatePath("/[locale]/dashboard/account-support", "page");
    revalidatePath("/[locale]/dashboard/account-security", "page");
    return {
      ok: true,
      data: {
        artifactId: row.artifact_id,
        artifactHash: row.artifact_hash,
        sizeBytes: Number(row.size_bytes),
        expiresAt: row.expires_at,
        subjectRole: row.subject_role,
        dataScope: row.data_scope,
      },
    };
  } catch (error) {
    return actionError<PreparedUserRightsExport>(error, [...SUPPORT_CODES, "EXPORT_PREPARE_FAILED"]);
  }
}

export async function downloadUserRightsExportAction(input: unknown): Promise<ActionResult<UserRightsExportDownload>> {
  try {
    const { artifactId } = parse(exportArtifactSchema, { artifactId: input });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("UNAUTHENTICATED");
    const { data, error } = await supabase.rpc("download_user_rights_export", { p_artifact_id: artifactId });
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as {
      file_name: string;
      artifact_hash: string;
      content_text: string;
      expires_at: string;
    } | undefined;
    if (!row) throw new Error("EXPORT_NOT_FOUND");
    revalidatePath("/[locale]/dashboard/account-security", "page");
    return {
      ok: true,
      data: {
        fileName: row.file_name,
        artifactHash: row.artifact_hash,
        contentText: row.content_text,
        expiresAt: row.expires_at,
      },
    };
  } catch (error) {
    return actionError<UserRightsExportDownload>(error, SELF_CODES);
  }
}
