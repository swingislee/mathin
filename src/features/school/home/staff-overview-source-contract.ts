import { hasSourceAssessmentConclusion, readSourceEnrollmentFacts } from "../business-source-contract";
import { zonedDateTimeToInstant } from "../schedule";
import { readSourceMetricFacts, uniqueSourceMetricRows, type SourceMetricKey } from "../source-metric-facts-contract";

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
  source_enrollment_facts?: unknown;
  source_metric_facts?: unknown;
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
  student_id: string | null;
  opportunity_id: string | null;
  registered_on: string | null;
  confirmed_at: string | null;
  created_at: string;
  source_record_id: string | null;
  source_metric_facts?: unknown;
  course_opportunities?: { student_id: string | null; lead_id: string | null } | null;
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
  registrationIds?: string[];
  at: string | null;
  studentId: string | null;
  leadId: string | null;
  activityId: string | null;
  sourceMonth?: string | null;
  sourceId?: string | null;
  sourceName?: string;
  sourceConfirmed?: boolean;
  sourcePerson?: string;
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

/** 报名读取独立登记和来源确认；入班记录用于花名册，日期沿用原业务事实。 */
export function buildOverviewSourceEvents(input: {
  activities: readonly OverviewActivity[];
  registrations: readonly OverviewRegistration[];
  assessments: readonly OverviewAssessment[];
  courseEnrollments: readonly OverviewCourseEnrollment[];
  memberships: readonly OverviewMembership[];
  enrollmentAssignments: readonly OverviewEnrollmentAssignment[];
}, timeZone: string, grain: "week" | "month" = "week") {
  const activities = new Map(input.activities.map(row => [row.id, row]));
  const registrations = new Map(input.registrations.map(row => [row.id, row]));
  const tagByRegistration = new Map(input.registrations.map(row => [row.id, readSourceMetricFacts(row.source_metric_facts)]));
  const activityAt = (id: string) => {
    const activity = activities.get(id);
    return activity ? overviewFactInstant(activity.scheduled_at, activity.occurred_on, timeZone) : null;
  };
  const visits = new Map<string, OverviewSourceEvent>();
  for (const row of input.registrations) {
    if (row.status !== "attended" || !activities.has(row.activity_id) || tagByRegistration.get(row.id)?.scope === "activity") continue;
    const at = activityAt(row.activity_id);
    // 同一来源到访拆成体验、测评两个产品时计一次；原生预约和另一次到访分别保留。
    const key = row.source_record_id ? JSON.stringify([row.source_record_id, at, row.student_id, row.lead_id]) : row.id;
    const existing = visits.get(key);
    if (existing) existing.registrationIds!.push(row.id);
    else visits.set(key, { id: row.id, registrationIds: [row.id], at, studentId: row.student_id, leadId: row.lead_id, activityId: row.activity_id });
  }
  const arrivals = Array.from(visits.values());
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
  const enrollments: OverviewSourceEvent[] = [
    ...input.courseEnrollments.filter(row => readSourceMetricFacts(row.source_metric_facts)?.scope !== "activity").map(row => ({
      id: row.id,
      at: overviewFactInstant(null, row.registered_on, timeZone)
        ?? (row.source_record_id ? null : overviewFactInstant(row.confirmed_at ?? row.created_at, null, timeZone)),
      studentId: row.student_id ?? row.course_opportunities?.student_id ?? null,
      leadId: row.course_opportunities?.lead_id ?? null, activityId: null,
    })),
  ];
  const courseSourceIds = new Map(input.courseEnrollments.map(row => [row.id, row.source_record_id]));
  const seenSourceEnrollments = new Set<string>();
  const subjectKey = (studentId: string | null, leadId: string | null) => studentId ? `student:${studentId}` : leadId ? `lead:${leadId}` : null;
  for (const registration of input.registrations) {
    if (tagByRegistration.get(registration.id)?.scope === "activity") continue;
    const facts = readSourceEnrollmentFacts(registration.source_enrollment_facts);
    if (!registration.source_record_id || !facts || !activities.has(registration.activity_id)) continue;
    const at = overviewFactInstant(null, facts.registeredOn, timeZone);
    // 来源报名只有确认与日期，未区分课程；同主体同日报名已有独立登记时沿用该登记。
    const registrationSubject = subjectKey(registration.student_id, registration.lead_id);
    const matches = enrollments.filter(event => {
      const eventSubject = subjectKey(event.studentId, event.leadId);
      const sameSubject = Boolean(registrationSubject && registrationSubject === eventSubject);
      return courseSourceIds.get(event.id) === registration.source_record_id && (!registrationSubject || !eventSubject || sameSubject)
        || at && event.at === at && sameSubject;
    });
    if (matches.length) {
      if (matches.length === 1) {
        matches[0].at ??= at;
        matches[0].studentId ??= registration.student_id;
        matches[0].activityId ??= registration.activity_id;
        matches[0].leadId ??= registration.lead_id;
      }
      continue;
    }
    const key = JSON.stringify([registration.source_record_id, at, registration.student_id, registration.lead_id]);
    if (seenSourceEnrollments.has(key)) continue;
    seenSourceEnrollments.add(key);
    enrollments.push({
      id: `source-enrollment:${registration.id}`, at,
      studentId: registration.student_id, leadId: registration.lead_id, activityId: registration.activity_id,
    });
  }
  const registrationIdsBySource = new Map<string, string[]>();
  for (const row of input.registrations) {
    const key = tagByRegistration.get(row.id)?.sourceKey;
    if (key) registrationIdsBySource.set(key, [...(registrationIdsBySource.get(key) ?? []), row.id]);
  }
  const tagged = uniqueSourceMetricRows(input.registrations.filter(row => tagByRegistration.get(row.id)));
  const sourceEvent = (row: OverviewRegistration, metric: SourceMetricKey): OverviewSourceEvent => {
    const facts = tagByRegistration.get(row.id)!;
    const at = metric === "enrollments" ? overviewFactInstant(null, readSourceEnrollmentFacts(row.source_enrollment_facts)?.registeredOn ?? null, timeZone)
      : metric === "invitations" || metric === "activityRegistrations" ? overviewFactInstant(null, row.registered_on, timeZone) : activityAt(row.activity_id);
    return { id: `source-${metric}:${facts.sourceKey}`, at, studentId: row.student_id, leadId: row.lead_id, activityId: row.activity_id,
      registrationIds: registrationIdsBySource.get(facts.sourceKey),
      sourceId: row.source_record_id, sourceName: facts.sourceName, sourceConfirmed: true,
      sourceMonth: facts.months[metric] ?? null, sourcePerson: facts.staff[metric] ?? "" };
  };
  const sourceMetric = (metric: SourceMetricKey) => tagged.filter(row => activities.has(row.activity_id)
    && tagByRegistration.get(row.id)!.confirmed[metric]).map(row => sourceEvent(row, metric));
  const tagByAssessment = new Map(input.assessments.map(row => [row.id, tagByRegistration.get(row.activity_registration_id)]));
  const tagByCourse = new Map(input.courseEnrollments.map(row => [row.id, readSourceMetricFacts(row.source_metric_facts)]));
  const sourceAssessments = sourceMetric("assessments");
  const selectedArrivals = grain === "month" ? [...arrivals.filter(row => !tagByRegistration.get(row.id)), ...sourceMetric("arrivals")] : arrivals;
  const selectedAssessments = [...assessments.filter(row => !tagByAssessment.get(row.id)), ...sourceAssessments];
  const selectedEnrollments = grain === "month" ? [
    ...enrollments.filter(row => !tagByCourse.get(row.id) && !tagByRegistration.get(row.id.replace(/^source-enrollment:/, ""))),
    ...sourceMetric("enrollments"),
  ] : enrollments;
  return { arrivals: selectedArrivals, assessments: selectedAssessments, enrollments: selectedEnrollments,
    sourceInvitations: sourceMetric("invitations"), activityRegistrations: sourceMetric("activityRegistrations") };
}

/** 尚未关联档案的 Lead 保留独立身份；多个空 student_id 不合并为一个人。 */
export function overviewSubjectKey(studentId: string | null, leadId: string | null, linkedStudentId: string | null, eventId: string): string {
  return studentId ?? linkedStudentId ?? (leadId ? `lead:${leadId}` : `record:${eventId}`);
}
