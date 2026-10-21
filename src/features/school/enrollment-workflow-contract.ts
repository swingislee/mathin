import { z } from "zod";
import { databaseUuid } from "@/lib/database-uuid";
import type { RenewalHealthSignal } from "./renewal-health-contract";
import type { StudentLabelStates } from "./student-labels-contract";

const nullableId = databaseUuid.nullable();
export const CONTACT_ROUTES = ["continue_follow_up", "await_product", "closed", "enrollment_pending"] as const;
export const CONTACT_CHANNELS = ["phone", "wechat", "in_person", "other"] as const;
export type EnrollmentSourceRef = { registrationId: string | null; invitationId: string | null };

export const activityEnrollmentContextSchema = z.object({
  registrationId: databaseUuid, studentId: nullableId, leadId: nullableId,
  name: z.string(), phone: z.string(), grade: z.number().nullable(), gradeText: z.string(),
  ownerId: nullableId, leadStatus: z.string().nullable(),
  activityId: databaseUuid, activityTitle: z.string(), activityAt: z.string(), eligible: z.boolean(),
  recommendation: z.string(), assessmentBand: z.string().nullable(), route: z.enum(CONTACT_ROUTES).nullable(),
  routeNote: z.string(), enrollmentId: nullableId, courseTitle: z.string().nullable(),
  termName: z.string().nullable(), classroomName: z.string().nullable(), termId: nullableId,
  canContact: z.boolean(), canEnroll: z.boolean(),
  canContactBeforeCompletion: z.boolean().optional(),
  contacts: z.array(z.object({
    id: databaseUuid, channel: z.enum(CONTACT_CHANNELS), outcome: z.enum(["connected", "unreachable"]),
    route: z.enum(CONTACT_ROUTES), note: z.string(), nextContactAt: z.string().nullable(),
    occurredAt: z.string(), recordedByName: z.string(),
  })),
});
export type ActivityEnrollmentContext = z.infer<typeof activityEnrollmentContextSchema>;

export const enrollmentWorkflowOptionsSchema = z.object({
  courses: z.array(z.object({ id: databaseUuid, title: z.string(), productCode: z.string().nullable(), grade: z.number(), classType: z.string() })),
  terms: z.array(z.object({ id: databaseUuid, name: z.string(), isCurrent: z.boolean(), startsOn: z.string().nullable(), endsOn: z.string().nullable() })),
  classrooms: z.array(z.object({
    id: databaseUuid, name: z.string(), courseId: nullableId, termId: databaseUuid, capacity: z.number().int().nonnegative().nullable(),
    grade: z.number().nullable().optional(), businessClassType: z.string().nullable().optional(),
    source: z.object({ teacherLabel: z.string(), scheduleLabel: z.string(), campusId: nullableId, campusLabel: z.string() }).nullable().optional(),
    activeCount: z.number().int().nonnegative(), operationalStatus: z.enum(["planning", "active"]), teacherNames: z.string(),
    teachers: z.array(z.object({ id: databaseUuid, name: z.string() })).optional(),
    location: z.object({ campusId: nullableId, campusName: z.string().nullable(), roomName: z.string().nullable() }).optional(),
    sessions: z.array(z.object({ at: z.string(), duration: z.number() })),
  })),
});
export type EnrollmentWorkflowOptions = z.infer<typeof enrollmentWorkflowOptionsSchema>;
export type PlacementClassroom = EnrollmentWorkflowOptions["classrooms"][number];

export const placementMemberSchema = z.object({
  membershipId: databaseUuid, studentId: databaseUuid, name: z.string(), phone: z.string(), classroomId: databaseUuid,
  enrollmentId: nullableId, note: z.string(), recommendation: z.string(),
  seat: z.number().int().positive().nullable().optional(),
  status: z.enum(["active", "paused", "withdrawn"]).optional(),
  canViewDetails: z.boolean().optional(),
});
export type PlacementMember = z.infer<typeof placementMemberSchema>;
export const enrollmentSchema = z.object({
  id: databaseUuid,
  opportunityId: databaseUuid,
  studentId: databaseUuid,
  studentName: z.string(),
  studentPhone: z.string(),
  courseId: databaseUuid,
  courseTitle: z.string(),
  termId: databaseUuid,
  termName: z.string(),
  status: z.enum(["active", "cancelled"]),
  note: z.string(),
  confirmedAt: z.string(),
  confirmedByName: z.string(),
  cancelledAt: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  assignmentId: nullableId,
  classroomId: nullableId,
  classroomName: z.string().nullable(),
  membershipId: nullableId,
  assignedAt: z.string().nullable(),
  claimableClassroomIds: z.array(databaseUuid),
  updatedAt: z.string(),
  canViewDetails: z.boolean().optional(),
});
export type CourseEnrollmentRow = z.infer<typeof enrollmentSchema>;

export const placementAccessSchema = z.object({
  canManageEnrollments: z.boolean(),
  teacherClassroomIds: z.array(databaseUuid),
  managedClassroomIds: z.array(databaseUuid),
});

export interface EnrollmentPlacementBoard {
  studentLabels?: StudentLabelStates;
  locationsFailed?: boolean;
  access?: z.infer<typeof placementAccessSchema>;
  sessionTransfers?: import('./enrollment-placement-change-contract').SessionTransfer[];
  options: EnrollmentWorkflowOptions;
  enrollments: CourseEnrollmentRow[];
  members: PlacementMember[];
  health?: Record<string, RenewalHealthSignal[]>;
  renewedMembershipIds?: string[];
}
export interface PlacementStudent {
  key: string;
  enrollmentId: string | null;
  membershipId: string | null;
  studentId: string;
  name: string;
  phone: string;
  grade: number;
  courseId: string;
  courseTitle: string;
  termId: string;
  classroomId: string | null;
  note: string;
  recommendation: string;
  seat: number | null;
  status: "active" | "paused" | "withdrawn";
  canViewDetails?: boolean;
}

export { canMovePlacement, placementStudents, placementDestinationError, followupState, placementHealth, placementStudentBackground, classWeeklyScheduleLabel, classScheduleLabel, enrollmentErrorKey } from "./enrollment-workflow-presentation";
