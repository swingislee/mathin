export const COURSE_OPPORTUNITY_TYPES = [
  "new",
  "renewal",
  "upsell",
  "reactivate",
  "referral",
] as const;

export type CourseOpportunityType = (typeof COURSE_OPPORTUNITY_TYPES)[number];

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

export interface CourseOpportunitySource {
  id: string;
  registrationId: string;
  route: "enrollment_pending" | "continue_follow_up" | "await_product";
  routeNote: string;
  studentId: string | null;
  leadId: string | null;
  name: string;
  phone: string;
  grade: number | null;
  gradeText: string;
  activityTitle: string;
  activityAt: string;
  suggestedStudentId: string | null;
  suggestedStudentName: string | null;
  updatedAt: string;
}

export interface CourseOpportunityRow {
  id: string;
  sourceActivityRouteId: string | null;
  studentId: string | null;
  leadId: string | null;
  originLeadId: string | null;
  name: string;
  phone: string;
  grade: number | null;
  gradeText: string;
  suggestedStudentId: string | null;
  suggestedStudentName: string | null;
  sourceActivityTitle: string | null;
  teacherRecommendation: string;
  opportunityType: CourseOpportunityType;
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
  courseEnrollmentId: string | null;
  courseEnrollmentStatus: "active" | "cancelled" | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseEnrollmentRow {
  id: string;
  opportunityId: string;
  studentId: string;
  studentName: string;
  studentPhone: string;
  courseId: string;
  courseTitle: string;
  termId: string;
  termName: string;
  status: "active" | "cancelled";
  note: string;
  confirmedAt: string;
  confirmedByName: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  assignmentId: string | null;
  classroomId: string | null;
  classroomName: string | null;
  membershipId: string | null;
  assignedAt: string | null;
  claimableClassroomIds: string[];
  updatedAt: string;
}

export interface Phase3CourseOption {
  id: string;
  title: string;
  productCode: string | null;
  grade: number;
  classType: string;
}

export interface Phase3TermOption {
  id: string;
  name: string;
  isCurrent: boolean;
  startsOn: string | null;
  endsOn: string | null;
}

export interface Phase3ClassroomOption {
  id: string;
  name: string;
  courseId: string;
  termId: string;
  capacity: number | null;
  activeCount: number;
  operationalStatus: "planning" | "active";
}

export interface Phase3EnrollmentOptions {
  courses: Phase3CourseOption[];
  terms: Phase3TermOption[];
  classrooms: Phase3ClassroomOption[];
}

export interface CourseOpportunityWorkbenchData {
  sources: CourseOpportunitySource[];
  opportunities: CourseOpportunityRow[];
}

export interface SaveCourseOpportunityInput {
  opportunityId: string | null;
  activityRouteId: string | null;
  studentId: string | null;
  leadId: string | null;
  opportunityType: CourseOpportunityType;
  courseId: string;
  termId: string;
  stage: Exclude<CourseOpportunityStage, "enrolled">;
  ownerId: string | null;
  nextAction: string;
  nextActionAt: string | null;
  note: string;
}
