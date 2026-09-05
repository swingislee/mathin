export const STUDENT_STATUSES = ["lead", "trialing", "enrolled", "paused", "alumni", "invalid"] as const;
export const FOLLOW_UP_STATUSES = ["pending", "following", "invited", "trialed", "signed", "lost"] as const;

export type StudentStatus = (typeof STUDENT_STATUSES)[number];
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export interface StudentSummary {
  id: string;
  name: string;
  grade: number | null;
  status: StudentStatus;
  followUpStatus: FollowUpStatus;
  assignedName: string;
  lastFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  deletedAt: string | null;
}
