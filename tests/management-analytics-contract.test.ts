import { describe, expect, it } from "vitest";
import {
  buildManagementMetric,
  normalizeManagementAnalyticsGrain,
  resolveManagementAttribution,
  resolveManagementAnalyticsSourceAccess,
  resolveManagementRegistrationLead,
  summarizeClassAttendance,
  summarizeManagementActivity,
  summarizeManagementBreakdown,
  summarizeManagementFunnel,
  type ManagementCohortFact,
} from "@/features/school/management-analytics-contract";

function fact(overrides: Partial<ManagementCohortFact> = {}): ManagementCohortFact {
  return {
    leadId: "lead-1",
    period: "current",
    cohortAt: "2026-09-01T00:00:00.000Z",
    channelKey: "community",
    channelLabel: "社区活动",
    channelSource: "xiaoditui",
    batchKey: "batch-1",
    batchLabel: "九月第一批",
    ownerId: "owner-1",
    ownerName: "学辅甲",
    ownerResolution: "snapshot",
    contacted: true,
    invited: true,
    arrived: false,
    assessed: false,
    ...overrides,
  };
}

describe("management analytics contract", () => {
  it("normalizes unsupported URL periods to the weekly management cohort", () => {
    expect(normalizeManagementAnalyticsGrain("month")).toBe("month");
    expect(normalizeManagementAnalyticsGrain("quarter")).toBe("week");
  });

  it("does not treat report access alone as complete bottom-table coverage", () => {
    expect(resolveManagementAnalyticsSourceAccess(new Set(["report.view.all"]))).toEqual({
      leadFacts: false,
      activityFacts: true,
      classAttendanceFacts: false,
    });
    expect(resolveManagementAnalyticsSourceAccess(new Set([
      "report.view.all",
      "followup.view",
      "student.view.all",
      "class.view.all",
    ]))).toEqual({
      leadFacts: true,
      activityFacts: true,
      classAttendanceFacts: true,
    });
  });

  it("keeps each funnel stage factual instead of backfilling missing upstream stages", () => {
    const result = summarizeManagementFunnel([
      fact(),
      fact({
        leadId: "lead-2",
        contacted: false,
        invited: false,
        arrived: true,
        assessed: true,
      }),
      fact({ leadId: "lead-3", period: "previous", contacted: false, invited: false }),
    ]);

    expect(result.current).toEqual({
      leads: 2,
      contacts: 1,
      invitations: 1,
      arrivals: 1,
      assessments: 1,
    });
    expect(result.previous.leads).toBe(1);
    expect(result.previous.contacts).toBe(0);
  });

  it("keeps snapshot, current-owner fallback, and unresolved attribution visible", () => {
    const rows = summarizeManagementBreakdown([
      fact(),
      fact({
        leadId: "lead-2",
        ownerId: "owner-1",
        ownerResolution: "current_owner_fallback",
        arrived: true,
      }),
      fact({
        leadId: "lead-3",
        ownerId: null,
        ownerName: "",
        ownerResolution: "unresolved",
        contacted: false,
        invited: false,
      }),
    ], "owner");

    const owner = rows.find((row) => row.key === "owner-1");
    expect(owner?.current.leads).toBe(2);
    expect(owner?.currentFallback).toEqual({
      leads: 1,
      contacts: 1,
      invitations: 1,
      arrivals: 1,
      assessments: 0,
    });
    const unresolved = rows.find((row) => row.key === "__unassigned__");
    expect(unresolved?.currentUnresolved.leads).toBe(1);
    expect(unresolved?.currentUnresolved.contacts).toBe(0);
  });

  it("uses only the first contact snapshot before falling through to the first invitation", () => {
    expect(resolveManagementAttribution({
      contactOwnerSnapshots: [null, "later-contact-owner"],
      invitationOwnerSnapshots: ["first-invitation-owner", "later-invitation-owner"],
      currentOwnerId: "current-owner",
    })).toEqual({
      ownerId: "first-invitation-owner",
      resolution: "snapshot",
    });

    expect(resolveManagementAttribution({
      contactOwnerSnapshots: [null, "later-contact-owner"],
      invitationOwnerSnapshots: [null, "later-invitation-owner"],
      currentOwnerId: "current-owner",
    })).toEqual({
      ownerId: "current-owner",
      resolution: "current_owner_fallback",
    });
  });

  it("does not attribute another student's registration to a lone activity invitation", () => {
    const invitedLead = { leadId: "lead-a", studentId: "student-a" };

    expect(resolveManagementRegistrationLead({
      explicitLeadId: null,
      registrationStudentId: "student-b",
      activityKind: "public_class",
      sourceInvitationLead: null,
      invitationCandidates: [invitedLead],
    })).toBeNull();

    expect(resolveManagementRegistrationLead({
      explicitLeadId: null,
      registrationStudentId: "student-a",
      activityKind: "public_class",
      sourceInvitationLead: null,
      invitationCandidates: [invitedLead],
    })).toBe("lead-a");
  });

  it("returns null rather than 0% when a denominator has no facts", () => {
    const metric = buildManagementMetric({
      numerator: 0,
      denominator: 0,
      grain: "week",
      cohort: "current",
      eventTimeField: "assessment_results.created_at",
      attributionRule: "assessment_result_to_registration",
      unresolvedCount: 0,
    });

    expect(metric.rate).toBeNull();
    expect(metric.eventTimeField).toBe("assessment_results.created_at");
    expect(metric.cohort).toBe("current");
  });

  it("excludes cancelled registrations from attendance and only assesses arrivals", () => {
    const summary = summarizeManagementActivity({
      id: "activity-1",
      title: "公开课",
      kind: "public_class",
      scheduledAt: "2026-09-03T02:00:00.000Z",
      capacity: 20,
      registrations: [
        { id: "r1", status: "attended" },
        { id: "r2", status: "no_show" },
        { id: "r3", status: "booked" },
        { id: "r4", status: "cancelled" },
      ],
      assessedRegistrationIds: new Set(["r1", "r2", "r4"]),
    });

    expect(summary.registrations).toBe(3);
    expect(summary.attended).toBe(1);
    expect(summary.noShows).toBe(1);
    expect(summary.pendingResults).toBe(1);
    expect(summary.assessments).toBe(1);
  });

  it("uses membership validity at the session time for formal attendance", () => {
    const summary = summarizeClassAttendance({
      id: "session-1",
      classroomId: "class-1",
      title: "第 3 次课",
      scheduledAt: "2026-09-03T02:00:00.000Z",
      memberships: [
        { studentId: "active", joinedAt: "2026-08-01T00:00:00.000Z", leftAt: null },
        { studentId: "left-before", joinedAt: "2026-08-01T00:00:00.000Z", leftAt: "2026-09-01T00:00:00.000Z" },
        { studentId: "joined-after", joinedAt: "2026-09-04T00:00:00.000Z", leftAt: null },
        { studentId: "active", joinedAt: "2026-08-15T00:00:00.000Z", leftAt: null },
      ],
      attendance: [
        { studentId: "active", status: "late" },
        { studentId: "left-before", status: "present" },
      ],
    });

    expect(summary.expected).toBe(1);
    expect(summary.recorded).toBe(1);
    expect(summary.attended).toBe(1);
    expect(summary.missing).toBe(0);
    expect(summary.unexpected).toBe(1);
  });
});
