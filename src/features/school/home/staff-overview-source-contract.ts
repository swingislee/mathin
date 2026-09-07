import { hasSourceAssessmentConclusion } from "../business-source-contract";
import { zonedDateTimeToInstant } from "../schedule";

export interface OverviewActivity {
  id: string;
  scheduled_at: string | null;
  occurred_on: string | null;
  source_invitation_id: string | null;
  remark: string;
  record_state: string;
}

export interface OverviewRegistration {
  id: string;
  activity_id: string;
  student_id: string | null;
  lead_id: string | null;
  status: string;
  record_state: string;
  registered_on: string | null;
  created_at: string;
  source_record_id: string | null;
  assessment_started_at: string | null;
  assessment_completed_at: string | null;
}

export interface OverviewAssessment {
  id: string;
  activity_registration_id: string;
  student_id: string | null;
  lead_id: string | null;
  assessed_by: string | null;
  assessed_on: string | null;
  created_at: string;
  source_record_id: string | null;
  result_source: string;
  result_finalized_at: string | null;
  assessment_band: string | null;
  score: number | null;
  strengths: string;
}

export interface OverviewCourseEnrollment {
  id: string;
  student_id: string;
  opportunity_id: string | null;
  registered_on: string | null;
  confirmed_at: string | null;
  created_at: string;
  source_record_id: string | null;
}

export interface OverviewMembership {
  id: string;
  classroom_id: string;
  student_id: string;
  joined_at: string;
  status: string;
  remark: string;
}

export interface OverviewEnrollmentAssignment {
  id: string;
  course_enrollment_id: string;
  classroom_membership_id: string | null;
}

export interface OverviewSourceEvent {
  id: string;
  at: string | null;
  studentId: string | null;
  leadId: string | null;
  activityId: string | null;
}

/** 日期以机构时区归日；缺少发生日期时保持空值。 */
export function overviewFactInstant(timestamp: string | null, date: string | null, timeZone: string): string | null {
  if (timestamp && Number.isFinite(new Date(timestamp).getTime())) return new Date(timestamp).toISOString();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return zonedDateTimeToInstant({ year, month: month - 1, day }, timeZone).toISOString();
}

export function overviewAssessmentCompleted(result: OverviewAssessment, registration: OverviewRegistration | undefined): boolean {
  if (!registration || registration.status !== "attended") return false;
  if (result.result_finalized_at || registration.assessment_completed_at) return true;
  return result.result_source === "legacy" && !registration.assessment_started_at && (
    !result.source_record_id || hasSourceAssessmentConclusion({
      assessmentBand: result.assessment_band, score: result.score, strengths: result.strengths,
    })
  );
}

/** 报名与入班通过已有桥接去重；导入记录沿用原业务日期，创建时间只用于原生记录。 */
export function buildOverviewSourceEvents(input: {
  activities: readonly OverviewActivity[];
  registrations: readonly OverviewRegistration[];
  assessments: readonly OverviewAssessment[];
  courseEnrollments: readonly OverviewCourseEnrollment[];
  memberships: readonly OverviewMembership[];
  enrollmentAssignments: readonly OverviewEnrollmentAssignment[];
}, timeZone: string) {
  const activities = new Map(input.activities.map(row => [row.id, row]));
  const registrations = new Map(input.registrations.map(row => [row.id, row]));
  const activityAt = (id: string) => {
    const activity = activities.get(id);
    return activity ? overviewFactInstant(activity.scheduled_at, activity.occurred_on, timeZone) : null;
  };
  const arrivals: OverviewSourceEvent[] = input.registrations
    .filter(row => row.status === "attended" && activities.has(row.activity_id))
    .map(row => ({ id: row.id, at: activityAt(row.activity_id), studentId: row.student_id, leadId: row.lead_id, activityId: row.activity_id }));
  const assessments: OverviewSourceEvent[] = input.assessments
    .filter(row => overviewAssessmentCompleted(row, registrations.get(row.activity_registration_id)))
    .filter(row => activities.has(registrations.get(row.activity_registration_id)!.activity_id))
    .map(row => {
      const registration = registrations.get(row.activity_registration_id)!;
      const at = overviewFactInstant(null, row.assessed_on, timeZone)
        ?? overviewFactInstant(row.result_finalized_at ?? registration.assessment_completed_at, null, timeZone)
        ?? activityAt(registration.activity_id)
        ?? (row.source_record_id ? null : overviewFactInstant(row.created_at, null, timeZone));
      return { id: row.id, at, studentId: row.student_id ?? registration.student_id, leadId: row.lead_id ?? registration.lead_id, activityId: registration.activity_id };
    });
  const courseIds = new Set(input.courseEnrollments.map(row => row.id));
  const bridgedMemberships = new Set(input.enrollmentAssignments
    .filter(row => courseIds.has(row.course_enrollment_id))
    .map(row => row.classroom_membership_id).filter(Boolean));
  const enrollments: OverviewSourceEvent[] = [
    ...input.courseEnrollments.map(row => ({
      id: row.id,
      at: overviewFactInstant(null, row.registered_on, timeZone)
        ?? (row.source_record_id ? null : overviewFactInstant(row.confirmed_at ?? row.created_at, null, timeZone)),
      studentId: row.student_id, leadId: null, activityId: null,
    })),
    // 花名册导入 RPC 把 joined_at 设为导入时刻；它提供在读快照，报名日期读取独立报名登记。
    ...input.memberships.filter(row => !bridgedMemberships.has(row.id) && !row.remark?.startsWith("班级学员导入：")).map(row => ({
      id: row.id, at: overviewFactInstant(row.joined_at, null, timeZone), studentId: row.student_id, leadId: null, activityId: null,
    })),
  ];
  return { arrivals, assessments, enrollments };
}

/** 尚未关联档案的 Lead 保留独立身份；多个空 student_id 不合并为一个人。 */
export function overviewSubjectKey(studentId: string | null, leadId: string | null, linkedStudentId: string | null, eventId: string): string {
  return studentId ?? linkedStudentId ?? (leadId ? `lead:${leadId}` : `record:${eventId}`);
}
