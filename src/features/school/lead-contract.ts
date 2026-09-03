/** Client-safe lead constants and DTOs shared by the server reader and table UI. */
export const LEAD_STATUSES = [
  "unassigned",
  "uncontacted",
  "contacted",
  "nurture",
  "intent_confirmed",
  "invalid",
  "converted",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadPoolScope = "unassigned" | "mine" | "all";
export type LeadContactOutcome = "unreachable" | "connected" | "declined" | "invalid_number";
export type LeadInterestLevel = "A" | "B" | "C";

export interface LeadPoolFilters {
  scope: LeadPoolScope;
  status?: LeadStatus;
  q?: string;
  page: number;
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
  sourceMarkedDuplicate: boolean;
  interests: string[];
  contactCount: number;
  lastContactAt: string | null;
  lastContactOutcome: LeadContactOutcome | null;
  lastContactNote: string;
  wechatAdded: boolean | null;
  visitCommitted: boolean | null;
  interestLevel: LeadInterestLevel | null;
}
