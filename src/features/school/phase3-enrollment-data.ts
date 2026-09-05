import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  COURSE_OPPORTUNITY_STAGES,
  COURSE_OPPORTUNITY_TYPES,
  type CourseEnrollmentRow,
  type CourseOpportunityWorkbenchData,
  type Phase3EnrollmentOptions,
} from "./phase3-enrollment-contract";

type UntypedRpc = (
  name: string,
  args?: Record<string, never>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(supabase: { rpc: unknown }): UntypedRpc {
  return (supabase.rpc as UntypedRpc).bind(supabase);
}

const nullableUuid = z.uuid().nullable();

const opportunitySourceSchema = z.object({
  id: z.uuid(),
  registrationId: z.uuid(),
  route: z.enum(["enrollment_pending", "continue_follow_up", "await_product"]),
  routeNote: z.string(),
  studentId: nullableUuid,
  leadId: nullableUuid,
  name: z.string(),
  phone: z.string(),
  grade: z.number().int().nullable(),
  gradeText: z.string(),
  activityTitle: z.string(),
  activityAt: z.string(),
  suggestedStudentId: nullableUuid,
  suggestedStudentName: z.string().nullable(),
  updatedAt: z.string(),
});

const opportunitySchema = z.object({
  id: z.uuid(),
  sourceActivityRouteId: nullableUuid,
  studentId: nullableUuid,
  leadId: nullableUuid,
  originLeadId: nullableUuid,
  name: z.string(),
  phone: z.string(),
  grade: z.number().int().nullable(),
  gradeText: z.string(),
  suggestedStudentId: nullableUuid,
  suggestedStudentName: z.string().nullable(),
  sourceActivityTitle: z.string().nullable(),
  teacherRecommendation: z.string(),
  opportunityType: z.enum(COURSE_OPPORTUNITY_TYPES),
  courseId: z.uuid(),
  courseTitle: z.string(),
  termId: z.uuid(),
  termName: z.string(),
  stage: z.enum(COURSE_OPPORTUNITY_STAGES),
  ownerId: z.uuid(),
  ownerName: z.string(),
  nextAction: z.string(),
  nextActionAt: z.string().nullable(),
  note: z.string(),
  courseEnrollmentId: nullableUuid,
  courseEnrollmentStatus: z.enum(["active", "cancelled"]).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const opportunityWorkbenchSchema = z.object({
  sources: z.array(opportunitySourceSchema),
  opportunities: z.array(opportunitySchema),
});

const enrollmentSchema = z.object({
  id: z.uuid(),
  opportunityId: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string(),
  studentPhone: z.string(),
  courseId: z.uuid(),
  courseTitle: z.string(),
  termId: z.uuid(),
  termName: z.string(),
  status: z.enum(["active", "cancelled"]),
  note: z.string(),
  confirmedAt: z.string(),
  confirmedByName: z.string(),
  cancelledAt: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  assignmentId: nullableUuid,
  classroomId: nullableUuid,
  classroomName: z.string().nullable(),
  membershipId: nullableUuid,
  assignedAt: z.string().nullable(),
  claimableClassroomIds: z.array(z.uuid()),
  updatedAt: z.string(),
});

const optionsSchema = z.object({
  courses: z.array(z.object({
    id: z.uuid(),
    title: z.string(),
    productCode: z.string().nullable(),
    grade: z.number().int(),
    classType: z.string(),
  })),
  terms: z.array(z.object({
    id: z.uuid(),
    name: z.string(),
    isCurrent: z.boolean(),
    startsOn: z.string().nullable(),
    endsOn: z.string().nullable(),
  })),
  classrooms: z.array(z.object({
    id: z.uuid(),
    name: z.string(),
    courseId: z.uuid(),
    termId: z.uuid(),
    capacity: z.number().int().nullable(),
    activeCount: z.number().int().nonnegative(),
    operationalStatus: z.enum(["planning", "active"]),
  })),
});

export async function loadCourseOpportunityWorkbench(): Promise<CourseOpportunityWorkbenchData> {
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_course_opportunity_workbench");
  if (error) throw new Error(error.message);
  const workbench = opportunityWorkbenchSchema.parse(data);
  return {
    ...workbench,
    // “等待产品”尚未形成具体课程与学期，继续留在等待池。
    sources: workbench.sources.filter((source) => source.route !== "await_product"),
  };
}

export async function loadCourseEnrollmentWorkbench(): Promise<CourseEnrollmentRow[]> {
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_course_enrollment_workbench");
  if (error) throw new Error(error.message);
  return z.array(enrollmentSchema).parse(data);
}

export async function loadPhase3EnrollmentOptions(): Promise<Phase3EnrollmentOptions> {
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_phase3_enrollment_options");
  if (error) throw new Error(error.message);
  return optionsSchema.parse(data);
}
