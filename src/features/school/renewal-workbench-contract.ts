import type { CourseOpportunityStage } from "./renewal-contract";

export const RENEWAL_RESULTS = ["considering", "payment_pending", "registered", "paid", "not_enrolled", "nurturing"] as const;
export type RenewalResult = typeof RENEWAL_RESULTS[number];
export const RENEWAL_PANELS = ["learning", "communication", "registration"] as const;
export type RenewalPanel = typeof RENEWAL_PANELS[number];
export const RENEWAL_CONTACT_METHODS = ["individual", "parent_meeting", "phone", "wechat"] as const;
export type RenewalContactMethod = typeof RENEWAL_CONTACT_METHODS[number];
export const RENEWAL_SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type RenewalSeason = typeof RENEWAL_SEASONS[number];
export const RENEWAL_PAYMENT_METHODS = ["mofaxiao_qr", "cash", "alipay", "offline_pos", "wechat", "bank_transfer", "other"] as const;
export type RenewalPaymentMethod = typeof RENEWAL_PAYMENT_METHODS[number];

export interface RenewalWorkbenchRecord {
  opportunityId: string;
  revision: number;
  contactMethod: RenewalContactMethod | null;
  seasons: RenewalSeason[];
  paidOn: string | null;
  paymentMethod: RenewalPaymentMethod | null;
  updatedAt: string;
}

export interface RenewalPayment {
  opportunity_id: string;
  period_count: number;
  paid_amount: number;
  note: string;
}

export interface RenewalWorkbenchSaved {
  record: RenewalWorkbenchRecord;
  stage: CourseOpportunityStage;
  note: string;
  nextContactAt: string | null;
  payment: RenewalPayment | null;
}

export interface RenewalWorkbenchDraft {
  result: RenewalResult;
  contactMethod: RenewalContactMethod | null;
  seasons: RenewalSeason[];
  note: string;
  nextContactAt: string | null;
  periodCount: string;
  paidAmount: string;
  paidOn: string;
  paymentMethod: RenewalPaymentMethod | null;
}

/** 报名事实由 Enrollment 确认；缴费事实由独立登记确认，缺少缴费记录保持已报名。 */
export function renewalResult(stage: string, payment?: RenewalPayment | null): RenewalResult | "unprepared" {
  if (stage === "enrolled") return payment ? "paid" : "registered";
  if (stage === "committed") return "payment_pending";
  if (stage === "contacted") return "considering";
  return ["considering", "payment_pending", "not_enrolled", "nurturing"].includes(stage)
    ? stage as RenewalResult : "unprepared";
}

export function renewalResultAllowsNextContact(result: RenewalResult) {
  return result !== "paid" && result !== "not_enrolled";
}

export function renewalResultCanBeSelected(result: RenewalResult, saved: string, canEnroll: boolean) {
  if ((result === "paid" || result === "registered") && !canEnroll) return false;
  if (saved === "paid") return result === "paid";
  if (saved === "registered") return result === "registered" || result === "paid";
  return true;
}

export function renewalDraftIsValid(draft: RenewalWorkbenchDraft, canEnroll: boolean) {
  if (draft.note.length > 2000) return false;
  if (draft.nextContactAt && !Number.isFinite(Date.parse(draft.nextContactAt))) return false;
  if (draft.result === "registered") return canEnroll;
  if (draft.result !== "paid") return true;
  const count = Number(draft.periodCount), amount = Number(draft.paidAmount);
  return canEnroll && Number.isInteger(count) && count >= 1 && count <= 24
    && /^\d+(\.\d{1,2})?$/.test(draft.paidAmount) && Number.isFinite(amount) && amount > 0 && amount <= 1_000_000
    && /^\d{4}-\d{2}-\d{2}$/.test(draft.paidOn)
    && Number.isFinite(Date.parse(draft.paidOn + "T00:00:00Z"))
    && new Date(draft.paidOn + "T00:00:00Z").toISOString().slice(0, 10) === draft.paidOn
    && draft.paymentMethod !== null;
}
