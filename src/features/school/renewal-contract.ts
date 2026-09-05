export const COURSE_OPPORTUNITY_STAGES = [
  "planning",
  "contacted",
  "considering",
  "committed",
  "payment_pending",
  "enrolled",
  "not_enrolled",
  "nurturing",
] as const;

export type CourseOpportunityStage = (typeof COURSE_OPPORTUNITY_STAGES)[number];

export const RENEWAL_CYCLE_STATUSES = ["planning", "open", "closed"] as const;
export type RenewalCycleStatus = (typeof RENEWAL_CYCLE_STATUSES)[number];

export const TEACHER_PROFESSIONAL_SIGNAL_TYPES = [
  "renewal_recommendation",
  "upsell_recommendation",
  "churn_risk",
  "reactivation_recommendation",
] as const;
export type TeacherProfessionalSignalType = (typeof TEACHER_PROFESSIONAL_SIGNAL_TYPES)[number];

export const TEACHER_PROFESSIONAL_SIGNAL_STATUSES = ["pending", "accepted", "dismissed"] as const;
export type TeacherProfessionalSignalStatus = (typeof TEACHER_PROFESSIONAL_SIGNAL_STATUSES)[number];

export const RENEWAL_POOL_VIEWS = ["active", "committed", "closed", "all"] as const;
export type RenewalPoolView = (typeof RENEWAL_POOL_VIEWS)[number];

export interface RenewalTermOption {
  id: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
}

export interface RenewalCourseOption {
  id: string;
  title: string;
  grade: number | null;
}

export interface RenewalStaffOption {
  id: string;
  name: string;
}

export interface RenewalCycleRow {
  id: string;
  name: string;
  campusId: string;
  sourceTermId: string;
  sourceTermName: string;
  targetTermId: string;
  targetTermName: string;
  status: RenewalCycleStatus;
  preparationStartsOn: string | null;
  decisionDueOn: string | null;
  opportunityCount: number;
  createdAt: string;
}

export interface RenewalCandidateRow {
  membershipId: string;
  studentId: string;
  studentName: string;
  grade: number | null;
  classroomId: string;
  classroomName: string;
  sourceCourseId: string | null;
  sourceCourseTitle: string;
  currentOwnerId: string | null;
  currentOwnerName: string;
  ready: boolean;
}

export interface LongTermOpportunityRow {
  id: string;
  opportunityType: "renewal" | "reactivate" | "referral";
  studentId: string;
  studentName: string;
  grade: number | null;
  courseId: string;
  courseTitle: string;
  termId: string;
  termName: string;
  stage: CourseOpportunityStage;
  ownerId: string;
  ownerName: string;
  nextAction: string;
  nextActionAt: string | null;
  note: string;
  cycleId: string | null;
  cycleName: string;
  sourceMembershipId: string | null;
  sourceClassroomName: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeacherProfessionalSignalRow {
  id: string;
  studentId: string;
  studentName: string;
  grade: number | null;
  sourceMembershipId: string;
  classroomId: string;
  sourceClassroomName: string;
  sourceSessionId: string | null;
  sourceSessionTitle: string;
  signalType: TeacherProfessionalSignalType;
  recommendation: string;
  suggestedCourseId: string | null;
  suggestedCourseTitle: string;
  targetTermId: string | null;
  targetTermName: string;
  sourceTeacherId: string;
  sourceTeacherName: string;
  status: TeacherProfessionalSignalStatus;
  opportunityId: string | null;
  handledByName: string;
  resolvedAt: string | null;
  occurredAt: string;
}

export interface StudentReferralRow {
  id: string;
  referrerStudentId: string;
  referrerStudentName: string;
  referrerFamilyId: string | null;
  referrerFamilyName: string;
  referrerContactId: string | null;
  referrerContactName: string;
  referredLeadId: string;
  referredSourceRecordId: string | null;
  referredLeadName: string;
  referredLeadStatus: string;
  leadOwnerId: string | null;
  leadOwnerName: string;
  relationship: string;
  note: string;
  opportunityId: string | null;
  createdAt: string;
}

export interface ReferralLeadOption {
  id: string;
  name: string;
  phone: string;
  status: string;
  studentId: string | null;
  sourceRecordId: string | null;
}

export interface ReferralReferrerOption {
  studentId: string;
  studentName: string;
  familyId: string | null;
  familyName: string;
  contactId: string | null;
  contactName: string;
}

export interface ReactivationStudentOption {
  id: string;
  name: string;
  grade: number | null;
  followUpStatus: string;
  assignedTo: string | null;
}

export interface ProfessionalSignalMembershipOption {
  membershipId: string;
  studentId: string;
  studentName: string;
  grade: number | null;
  classroomId: string;
  classroomName: string;
  currentCourseId: string | null;
  currentCourseTitle: string;
  status: "active" | "completed" | "transferred_out" | "withdrawn";
  joinedAt: string;
  leftAt: string | null;
}

export interface ProfessionalSignalSessionOption {
  id: string;
  classroomId: string;
  title: string;
  scheduledAt: string | null;
  startedAt: string | null;
}

export interface RenewalPoolFilters {
  view: RenewalPoolView;
  cycleId: string | null;
  query: string;
}

export interface RenewalPoolCounts {
  active: number;
  committed: number;
  closed: number;
  all: number;
}

export function isClosedOpportunity(stage: CourseOpportunityStage): boolean {
  return stage === "enrolled" || stage === "not_enrolled";
}

export function renewalPoolCounts(rows: readonly LongTermOpportunityRow[]): RenewalPoolCounts {
  return {
    active: rows.filter((row) => !isClosedOpportunity(row.stage)).length,
    committed: rows.filter((row) => row.stage === "committed" || row.stage === "payment_pending").length,
    closed: rows.filter((row) => isClosedOpportunity(row.stage)).length,
    all: rows.length,
  };
}

export function renewalPoolRowsForView(
  rows: readonly LongTermOpportunityRow[],
  filters: RenewalPoolFilters,
  locale: string,
): LongTermOpportunityRow[] {
  const query = filters.query.trim().toLocaleLowerCase(locale);
  return rows
    .filter((row) => row.opportunityType === "renewal")
    .filter((row) => !filters.cycleId || row.cycleId === filters.cycleId)
    .filter((row) => {
      if (filters.view === "active") return !isClosedOpportunity(row.stage);
      if (filters.view === "committed") return row.stage === "committed" || row.stage === "payment_pending";
      if (filters.view === "closed") return isClosedOpportunity(row.stage);
      return true;
    })
    .filter((row) => !query || [
      row.studentName,
      row.courseTitle,
      row.termName,
      row.ownerName,
      row.sourceClassroomName,
      row.nextAction,
    ].some((value) => value.toLocaleLowerCase(locale).includes(query)))
    .sort((left, right) => {
      const leftAt = left.nextActionAt ? Date.parse(left.nextActionAt) : Number.POSITIVE_INFINITY;
      const rightAt = right.nextActionAt ? Date.parse(right.nextActionAt) : Number.POSITIVE_INFINITY;
      if (leftAt !== rightAt) return leftAt - rightAt;
      return left.studentName.localeCompare(right.studentName, locale);
    });
}
