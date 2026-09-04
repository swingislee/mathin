import type { PermissionKey } from "@/features/school/permissions";

export const MANAGEMENT_ANALYTICS_GRAINS = ["week", "month"] as const;
export type ManagementAnalyticsGrain = (typeof MANAGEMENT_ANALYTICS_GRAINS)[number];

export function normalizeManagementAnalyticsGrain(value: string | undefined): ManagementAnalyticsGrain {
  return value === "month" ? "month" : "week";
}

export interface ManagementAnalyticsSourceAccess {
  leadFacts: boolean;
  activityFacts: boolean;
  classAttendanceFacts: boolean;
}

/**
 * `report.view.all` 只控制页面入口，不会绕过底表 RLS。只有现有策略能够覆盖全校记录时，
 * 对应数据源才可标为完整；否则聚合必须返回 null，而不是把 RLS 子集误报为全校 0 或低值。
 */
export function resolveManagementAnalyticsSourceAccess(
  permissions: ReadonlySet<PermissionKey>,
): ManagementAnalyticsSourceAccess {
  const canReport = permissions.has("report.view.all");
  return {
    leadFacts: canReport
      && permissions.has("followup.view")
      && permissions.has("student.view.all"),
    // activities / activity_registrations / assessment_results 的现有 SELECT 策略覆盖所有 active staff。
    activityFacts: canReport,
    classAttendanceFacts: canReport
      && permissions.has("class.view.all")
      && (permissions.has("student.view.all") || permissions.has("attendance.mark")),
  };
}

export const MANAGEMENT_FUNNEL_STAGES = [
  "leads",
  "contacts",
  "invitations",
  "arrivals",
  "assessments",
] as const;
export type ManagementFunnelStage = (typeof MANAGEMENT_FUNNEL_STAGES)[number];
export type ManagementAnalyticsPeriod = "current" | "previous";

export const MANAGEMENT_STAGE_EVENT_TIME_FIELDS: Record<ManagementFunnelStage, string> = {
  leads: "lead_source_records.submitted_at ?? lead_source_records.created_at",
  contacts: "lead_communications.occurred_at",
  invitations: "lead_invitation_events.occurred_at",
  arrivals: "activities.scheduled_at + activity_registrations.status",
  assessments: "assessment_results.created_at",
};

export type ManagementAttributionResolution = "snapshot" | "current_owner_fallback" | "unresolved";

export interface ManagementAttributionResult {
  ownerId: string | null;
  resolution: ManagementAttributionResolution;
}

/**
 * 负责人归因只读取每类事实的首条快照。首条快照为空时可以进入下一层，
 * 但不能跳过它而采用同类事实中更晚出现的负责人。
 */
export function resolveManagementAttribution({
  contactOwnerSnapshots,
  invitationOwnerSnapshots,
  currentOwnerId,
}: {
  contactOwnerSnapshots: readonly (string | null)[];
  invitationOwnerSnapshots: readonly (string | null)[];
  currentOwnerId: string | null;
}): ManagementAttributionResult {
  const snapshotOwner = contactOwnerSnapshots[0]
    ?? invitationOwnerSnapshots[0]
    ?? null;
  if (snapshotOwner) return { ownerId: snapshotOwner, resolution: "snapshot" };
  if (currentOwnerId) {
    return { ownerId: currentOwnerId, resolution: "current_owner_fallback" };
  }
  return { ownerId: null, resolution: "unresolved" };
}

export interface ManagementRegistrationLeadCandidate {
  leadId: string;
  studentId: string | null;
}

/**
 * 活动到场可以独立统计，但进入 Lead 漏斗必须有可审计的主体连接。
 * 不使用“活动恰好只有一个邀约”或“该学生最近一条 Lead”之类的概率推断。
 */
export function resolveManagementRegistrationLead({
  explicitLeadId,
  registrationStudentId,
  activityKind,
  sourceInvitationLead,
  invitationCandidates,
}: {
  explicitLeadId: string | null;
  registrationStudentId: string | null;
  activityKind: string;
  sourceInvitationLead: ManagementRegistrationLeadCandidate | null;
  invitationCandidates: readonly ManagementRegistrationLeadCandidate[];
}): string | null {
  if (explicitLeadId) return explicitLeadId;
  if (!registrationStudentId) return null;

  if (
    activityKind === "assessment_1v1"
    && sourceInvitationLead?.studentId === registrationStudentId
  ) {
    return sourceInvitationLead.leadId;
  }

  const matchingLeadIds = new Set(invitationCandidates
    .filter((candidate) => candidate.studentId === registrationStudentId)
    .map((candidate) => candidate.leadId));
  return matchingLeadIds.size === 1 ? Array.from(matchingLeadIds)[0] ?? null : null;
}

export interface ManagementMetricDto {
  numerator: number | null;
  denominator: number | null;
  rate: number | null;
  grain: ManagementAnalyticsGrain;
  cohort: ManagementAnalyticsPeriod | "snapshot";
  eventTimeField: string;
  attributionRule: string;
  unresolvedCount: number | null;
}

export function buildManagementMetric({
  numerator,
  denominator,
  grain,
  cohort,
  eventTimeField,
  attributionRule,
  unresolvedCount,
}: Omit<ManagementMetricDto, "rate">): ManagementMetricDto {
  return {
    numerator,
    denominator,
    rate: conversionRate(numerator, denominator),
    grain,
    cohort,
    eventTimeField,
    attributionRule,
    unresolvedCount,
  };
}

export interface ManagementFunnelCounts {
  leads: number;
  contacts: number;
  invitations: number;
  arrivals: number;
  assessments: number;
}

export interface ManagementCohortFact {
  leadId: string;
  period: ManagementAnalyticsPeriod;
  cohortAt: string;
  channelKey: string;
  channelLabel: string;
  channelSource: string;
  batchKey: string;
  batchLabel: string;
  ownerId: string | null;
  ownerName: string;
  ownerResolution: ManagementAttributionResolution;
  contacted: boolean;
  invited: boolean;
  arrived: boolean;
  assessed: boolean;
}

export interface ManagementBreakdownRow {
  key: string;
  label: string;
  detail: string;
  current: ManagementFunnelCounts;
  previous: ManagementFunnelCounts;
  currentFallback: ManagementFunnelCounts;
  previousFallback: ManagementFunnelCounts;
  currentUnresolved: ManagementFunnelCounts;
  previousUnresolved: ManagementFunnelCounts;
}

export type ManagementBreakdownDimension = "channel" | "batch" | "owner";

function emptyCounts(): ManagementFunnelCounts {
  return { leads: 0, contacts: 0, invitations: 0, arrivals: 0, assessments: 0 };
}

function addFact(counts: ManagementFunnelCounts, fact: ManagementCohortFact): void {
  counts.leads += 1;
  if (fact.contacted) counts.contacts += 1;
  if (fact.invited) counts.invitations += 1;
  if (fact.arrived) counts.arrivals += 1;
  if (fact.assessed) counts.assessments += 1;
}

/**
 * 每一层只计算实际存在的事实，不强行把后段事实补写成前段事实。
 * 因此一条脏数据可以表现为“已测评但缺少确认邀约”，供管理者发现数据断链。
 */
export function summarizeManagementFunnel(
  facts: readonly ManagementCohortFact[],
): Record<ManagementAnalyticsPeriod, ManagementFunnelCounts> {
  const result = { current: emptyCounts(), previous: emptyCounts() };
  for (const fact of facts) addFact(result[fact.period], fact);
  return result;
}

function dimensionValue(
  fact: ManagementCohortFact,
  dimension: ManagementBreakdownDimension,
): { key: string; label: string; detail: string } {
  if (dimension === "channel") {
    return { key: fact.channelKey, label: fact.channelLabel, detail: fact.channelSource };
  }
  if (dimension === "batch") {
    return { key: fact.batchKey, label: fact.batchLabel, detail: fact.batchKey };
  }
  return {
    key: fact.ownerId ?? "__unassigned__",
    label: fact.ownerName,
    detail: fact.ownerId ?? "",
  };
}

export function summarizeManagementBreakdown(
  facts: readonly ManagementCohortFact[],
  dimension: ManagementBreakdownDimension,
): ManagementBreakdownRow[] {
  const rows = new Map<string, ManagementBreakdownRow>();
  for (const fact of facts) {
    const value = dimensionValue(fact, dimension);
    const row = rows.get(value.key) ?? {
      ...value,
      current: emptyCounts(),
      previous: emptyCounts(),
      currentFallback: emptyCounts(),
      previousFallback: emptyCounts(),
      currentUnresolved: emptyCounts(),
      previousUnresolved: emptyCounts(),
    };
    addFact(row[fact.period], fact);
    if (dimension === "owner" && fact.ownerResolution === "current_owner_fallback") {
      addFact(row[fact.period === "current" ? "currentFallback" : "previousFallback"], fact);
    }
    const unresolved = dimension === "owner"
      ? fact.ownerResolution === "unresolved"
      : dimension === "channel"
        ? fact.channelKey === "__unknown_channel__"
        : fact.batchKey === "__no_batch__";
    if (unresolved) {
      addFact(row[fact.period === "current" ? "currentUnresolved" : "previousUnresolved"], fact);
    }
    rows.set(value.key, row);
  }
  return Array.from(rows.values()).sort((left, right) => (
    right.current.leads - left.current.leads
    || right.current.assessments - left.current.assessments
    || right.previous.leads - left.previous.leads
    || left.label.localeCompare(right.label)
  ));
}

export interface ManagementActivityRegistrationFact {
  id: string;
  status: "booked" | "attended" | "no_show" | "cancelled" | string;
}

export interface ManagementActivityFact {
  id: string;
  title: string;
  kind: string;
  scheduledAt: string;
  capacity: number | null;
  registrations: readonly ManagementActivityRegistrationFact[];
  assessedRegistrationIds: ReadonlySet<string>;
}

export interface ManagementActivitySummary {
  id: string;
  title: string;
  kind: string;
  scheduledAt: string;
  capacity: number | null;
  registrations: number;
  attended: number;
  noShows: number;
  pendingResults: number;
  assessments: number;
}

/** 取消报名不进入到场率分母；已排期但仍停留 booked 的记录明确计入待回填。 */
export function summarizeManagementActivity(
  activity: ManagementActivityFact,
): ManagementActivitySummary {
  const eligible = activity.registrations.filter((registration) => registration.status !== "cancelled");
  const attended = eligible.filter((registration) => registration.status === "attended");
  return {
    id: activity.id,
    title: activity.title,
    kind: activity.kind,
    scheduledAt: activity.scheduledAt,
    capacity: activity.capacity,
    registrations: eligible.length,
    attended: attended.length,
    noShows: eligible.filter((registration) => registration.status === "no_show").length,
    pendingResults: eligible.filter((registration) => registration.status === "booked").length,
    assessments: attended.filter((registration) => activity.assessedRegistrationIds.has(registration.id)).length,
  };
}

export interface ManagementClassMembershipFact {
  studentId: string;
  joinedAt: string;
  leftAt: string | null;
}

export interface ManagementSessionAttendanceFact {
  studentId: string;
  status: "present" | "absent" | "late" | "leave" | string;
}

export interface ManagementClassAttendanceFact {
  id: string;
  classroomId: string;
  title: string;
  scheduledAt: string;
  memberships: readonly ManagementClassMembershipFact[];
  attendance: readonly ManagementSessionAttendanceFact[];
}

export interface ManagementClassAttendanceSummary {
  id: string;
  classroomId: string;
  title: string;
  scheduledAt: string;
  expected: number;
  recorded: number;
  attended: number;
  absent: number;
  leave: number;
  missing: number;
  unexpected: number;
}

/**
 * 正式课分母取课次发生时仍有效的 ClassMembership，而不是今天仍为 active 的成员。
 * 同一学生即使存在重复关系也只进入一次分母；名单外点名保留为 unexpected 数据质量事实。
 */
export function summarizeClassAttendance(
  session: ManagementClassAttendanceFact,
): ManagementClassAttendanceSummary {
  const scheduledAt = new Date(session.scheduledAt).getTime();
  const expectedIds = new Set(session.memberships
    .filter((membership) => {
      const joinedAt = new Date(membership.joinedAt).getTime();
      const leftAt = membership.leftAt ? new Date(membership.leftAt).getTime() : Number.POSITIVE_INFINITY;
      return joinedAt <= scheduledAt && scheduledAt < leftAt;
    })
    .map((membership) => membership.studentId));
  const attendanceByStudent = new Map(session.attendance.map((fact) => [fact.studentId, fact.status]));
  let attended = 0;
  let absent = 0;
  let leave = 0;
  let recorded = 0;
  for (const studentId of expectedIds) {
    const status = attendanceByStudent.get(studentId);
    if (!status) continue;
    recorded += 1;
    if (status === "present" || status === "late") attended += 1;
    else if (status === "absent") absent += 1;
    else if (status === "leave") leave += 1;
  }
  return {
    id: session.id,
    classroomId: session.classroomId,
    title: session.title,
    scheduledAt: session.scheduledAt,
    expected: expectedIds.size,
    recorded,
    attended,
    absent,
    leave,
    missing: Math.max(0, expectedIds.size - recorded),
    unexpected: session.attendance.filter((fact) => !expectedIds.has(fact.studentId)).length,
  };
}

export function conversionRate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}
