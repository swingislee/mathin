/** 三端共用的业务 DTO；微信副本由 sync-parent-contract.mjs 生成。 */
export type Locale = "zh" | "en";
export type LocalizedText = { zh: string; en: string };
export type FormField = {
  id: string;
  type: "text" | "phone" | "textarea" | "select" | "multiselect";
  label: LocalizedText;
  required: boolean;
  options?: { id: string; label: LocalizedText }[];
};
export type IntakeForm = {
  slug: string; version: number; title: LocalizedText; description: LocalizedText;
  privacyNotice: LocalizedText; fields: FormField[];
};
export type Participant = { id: string; name: string };
export type Activity = {
  id: string; title: LocalizedText; description: LocalizedText; location: string;
  startsAt: string; durationMinutes: number | null; remaining: number | null;
  bookable: boolean;
};
export type Booking = {
  id: string; activityId: string; participantId: string; participantName: string;
  title: LocalizedText; startsAt: string; location: string;
  status: "booked" | "attended" | "no_show" | "cancelled";
};
export type Report = {
  id: string; kind: "assessment" | "feedback"; title: string;
  participantName: string; date: string; summary: string; strengths: string;
  focusAreas: string; recommendation: string; score: number | null; totalScore: number | null;
};
export type Practice = {
  id: string; participantId: string; participantName: string; title: string;
  instructions: string; dueAt: string | null; submittedAt: string | null;
};
export type Media = { id: string; kind: "image" | "video"; name: string; bytes: number; url?: string };
export type PracticeSubmission = { id: string; submittedAt: string; note: string; media: Media[] };
export type Session = { accessToken: string; refreshToken: string; expiresAt: number };
export type Account = { id: string; displayName: string; participants: Participant[] };
export type ApiErrorCode = "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "ACCOUNT_SECURITY"
  | "NOT_FOUND" | "FORM_CHANGED" | "ACTIVITY_FULL" | "BOOKING_CLOSED" | "CONFLICT"
  | "TOO_LARGE" | "FILE_TYPE" | "RATE_LIMIT" | "UNAVAILABLE";
