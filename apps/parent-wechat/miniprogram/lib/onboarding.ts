import type { Session, RegistrationForm } from "./api-types";
import type { FamilyAnswers, FamilyChild, FamilyForm, RegistrationLocation } from "./onboarding-form";
export type { RegistrationLocation } from "./onboarding-form";

export type FamilyRegistration = FamilyAnswers & {
  formVersion?: number; location: RegistrationLocation;
  privacyVersion: string; childrenPrivacyVersion: string; consent: true;
};
export type PhoneResult = { state: "family_required"; ticket: string; form: FamilyForm; maskedPhone: string; privacyVersion: string; childrenPrivacyVersion: string;
  accountId?: string; contact?: RegistrationForm["contact"];
  existingParticipants?: (Pick<FamilyChild, "childName" | "gender" | "grade" | "school"> & { id: string })[];
  policyText: { zh: { privacy: string; children: string }; en: { privacy: string; children: string } } };
export type RegistrationResult = { state: "authenticated"; session: Session; participantId: string | null; participantIds?: string[]; grade: number | null };

// This proof stays in memory and expires server-side. It is never put in URL or persistent storage.
let currentProof: { ticket: string; scene: string; phoneVerified: boolean } | null = null;
export function setOnboardingProof(ticket: string, scene = "", phoneVerified = false) { currentProof = { ticket, scene, phoneVerified }; }
export function takeOnboardingProof() { const value = currentProof; currentProof = null; return value; }
export function promotionScene(value: string | undefined): string {
  try { const decoded = decodeURIComponent(value || ""); return /^[a-f0-9]{24}$/.test(decoded) ? decoded : ""; }
  catch { return ""; }
}
export function stageForGrade(grade: number) { return grade === -1 ? "k2" : grade === 0 ? "k3" : `g${grade}`; }
export function saveOnboardingPreferences(grade: number) {
  wx.setStorageSync("gezhi.activity-catalog.filters.v1", { stage: stageForGrade(grade) });
}

export { onboardingCopy } from "./onboarding-presentation";
