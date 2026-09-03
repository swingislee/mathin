import type { InvitationSummary } from "./invitation-contract";

/** Client-safe lead constants and DTOs shared by the server reader and table UI. */
export const LEAD_STATUSES = [
  "uncontacted",
  "contacted",
  "nurture",
  "intent_confirmed",
  "invalid",
  "converted",
] as const;

export const LEAD_PAGE_SIZES = [20, 50, 100] as const;
export const LEAD_DEFAULT_PAGE_SIZE = 100;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadPageSize = (typeof LEAD_PAGE_SIZES)[number];
export type LeadPoolScope = "unassigned" | "mine" | "all";
export type LeadContactOutcome = "unreachable" | "connected" | "declined" | "invalid_number";
export type LeadInterestLevel = "A" | "B" | "C";

/** Mirror the database routing rule so the entry row can preview its destination. */
export function deriveLeadContactDestination(
  outcome: LeadContactOutcome,
): LeadStatus {
  if (outcome === "invalid_number") return "invalid";
  if (outcome === "declined") return "nurture";
  if (outcome === "unreachable") return "uncontacted";
  return "contacted";
}

export function parseLeadPageSize(value: string | string[] | undefined): LeadPageSize {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return LEAD_PAGE_SIZES.includes(parsed as LeadPageSize)
    ? parsed as LeadPageSize
    : LEAD_DEFAULT_PAGE_SIZE;
}

export interface LeadPoolFilters {
  scope: LeadPoolScope;
  status?: LeadStatus;
  q?: string;
  page: number;
  pageSize: LeadPageSize;
}

export interface LeadPoolRow {
  id: string;
  provisionalStudentName: string;
  phone: string;
  gradeHint: number | null;
  gradeText: string;
  status: LeadStatus;
  ownerId: string | null;
  ownerName: string;
  suggestedStudentId: string | null;
  suggestedStudentName: string;
  createdAt: string;
  acquiredAt: string | null;
  acquisitionLocation: string;
  acquisitionMethod: string;
  acquisitionPromoter: string;
  sourceCount: number;
  sourceMarkedDuplicate: boolean;
  interests: string[];
  contactCount: number;
  lastContactAt: string | null;
  lastContactOutcome: LeadContactOutcome | null;
  lastContactNote: string;
  wechatAdded: boolean | null;
  visitCommitted: boolean | null;
  interestLevel: LeadInterestLevel | null;
  activeInvitation: InvitationSummary | null;
}
