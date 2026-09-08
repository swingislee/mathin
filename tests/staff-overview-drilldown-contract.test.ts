import { describe, expect, it } from "vitest";
import { buildStaffOverviewWindow } from "@/features/school/home/staff-overview-contract";
import { selectOverviewDetailEvents, selectOverviewParticipants } from "@/features/school/home/staff-overview-drilldown-contract";

const window = buildStaffOverviewWindow("month", new Date("2026-09-08T04:00:00Z"), "Asia/Shanghai");
describe("overview drilldown scopes", () => {
  const events = [
    { id: "invite", at: "2026-09-01T00:00:00Z", personId: "a" },
    { id: "invite", at: "2026-09-02T00:00:00Z", personId: "a" },
    { id: "invite", at: "2026-09-03T00:00:00Z", personId: "b" },
    { id: "none", at: "2026-09-04T00:00:00Z", personId: null },
    { id: "cutoff", at: window.currentCutoff.toISOString(), personId: "a" },
    { id: "previous", at: "2026-08-01T00:00:00Z", personId: "a" },
  ];
  it("matches institutional deduplication and excludes the cutoff", () => {
    expect(selectOverviewDetailEvents(events, window, { kind: "business", metric: "invitations" }).map(row => row.id)).toEqual(["invite", "none"]);
    expect(selectOverviewDetailEvents(events, window, { kind: "business", metric: "invitations", period: "previous" }).map(row => row.id)).toEqual(["previous"]);
  });
  it("keeps per-person contributions and distinguishes other staff from unassigned", () => {
    expect(selectOverviewDetailEvents(events, window, { kind: "support", metric: "invitations", scope: "__other__" }, ["a"]).map(row => row.personId)).toEqual(["b"]);
    expect(selectOverviewDetailEvents(events, window, { kind: "support", metric: "invitations", scope: "__unassigned__" }).map(row => row.id)).toEqual(["none"]);
    expect(selectOverviewDetailEvents(events, window, { kind: "support", metric: "invitations", scope: "__other__" }).length).toBe(2);
    expect(selectOverviewDetailEvents(events, window, { kind: "support", metric: "contacts", scope: "a" }).length).toBe(2);
  });
  it("uses each teacher's participation date for enrollment attribution", () => {
    const participation = [
      { id: "p1", studentId: "s", at: "2026-09-01T00:00:00Z", teacherIds: ["a"] },
      { id: "p2", studentId: "s", at: "2026-09-03T00:00:00Z", teacherIds: ["b"] },
      { id: "p3", studentId: "lead:x", at: "2026-09-02T00:00:00Z", teacherIds: [] },
    ];
    const enrollments = [{ id: "e", studentId: "s", at: "2026-09-02T00:00:00Z" }];
    expect(selectOverviewParticipants(participation, enrollments, window, { kind: "participation", metric: "enrollments", scope: "a" })).toHaveLength(1);
    expect(selectOverviewParticipants(participation, enrollments, window, { kind: "participation", metric: "enrollments", scope: "b" })).toHaveLength(0);
    expect(selectOverviewParticipants(participation, enrollments, window, { kind: "participation", metric: "conversion" })).toHaveLength(2);
    expect(selectOverviewParticipants(participation, enrollments, window, { kind: "participation", metric: "unattributed" })[0].studentId).toBe("lead:x");
  });
});
