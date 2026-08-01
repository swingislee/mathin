import "server-only";

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
    email: string;
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

export async function getAccountSupportSnapshot(): Promise<AccountSupportSnapshot> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_account_support_snapshot");
  if (error || !data) throw new Error(error?.message ?? "ACCOUNT_SUPPORT_UNAVAILABLE");
  return data as unknown as AccountSupportSnapshot;
}
