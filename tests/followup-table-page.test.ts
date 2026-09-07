import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessmentSourceOrder } from "@/features/school/assessment-source-order";
import { FOLLOWUP_DEFAULT_PAGE_SIZE, FOLLOWUP_PAGE_SIZES, followupFieldPage, followupPage, followupPageSize, parseFollowupFieldQuery } from "@/features/school/followup-table-page";
import { dashboardFieldFacets, filterAndSortDashboardFields, type DashboardFieldDefinitions, type DashboardFieldFilters } from "@/features/school/dashboard-page/dashboard-table-field-contract";
import { leadIntakeTableFields } from "@/features/school/lead-intake-table-fields";
import { placementTableFields, type PlacementRosterRow } from "@/features/school/placement-table-fields";
import { renewalTableFields } from "@/features/school/renewal-table-fields";
import { communicationTableFields, type CommunicationTableRow } from "@/features/school/communication-table-fields";
import type { LeadPoolRow } from "@/features/school/lead-contract";
import type { EnrollmentPlacementBoard, PlacementClassroom, PlacementStudent } from "@/features/school/enrollment-workflow-contract";
import type { RenewalPoolRow } from "@/features/school/RenewalRecordDetails";
import type { CommunicationWorkday } from "@/features/school/communication-workday-contract";

const context = { locale: "zh", timeZone: "Asia/Shanghai", now: Date.parse("2026-09-07T04:00:00Z") };
const t = (key: string) => key;
const query = (filters: DashboardFieldFilters) => ({ version: 2 as const, filters, sort: null });
const enumFilter = (...values: string[]) => ({ kind: "enum" as const, values });
const textFilter = (value: string) => ({ kind: "text" as const, query: value });
const match = <Row>(rows: Row[], fields: DashboardFieldDefinitions<Row>, filters: DashboardFieldFilters) =>
  filterAndSortDashboardFields(rows, fields, query(filters), context.locale, context.timeZone);
const lead = (id: string, extra: Partial<LeadPoolRow> = {}): LeadPoolRow => ({ id, provisionalStudentName: id, phone: "123", gradeHint: 3, gradeText: "",
  status: "uncontacted", ownerId: "owner-a", ownerName: "Owner", studentId: null, suggestedStudentId: null, suggestedStudentName: "",
  createdAt: "2026-09-07T01:00:00Z", acquiredAt: "2026-09-06", acquisitionLocation: "Park", acquisitionMethod: "Walk", acquisitionPromoter: "Promoter",
  sourceCount: 1, sourceMarkedDuplicate: false, interests: ["Math", "Coding"], contactCount: 0, lastContactAt: null, lastContactOutcome: null,
  lastContactNote: "", wechatAdded: null, visitCommitted: null, interestLevel: null, nextContactAt: null, activeInvitation: null, ...extra });

describe("five follow-up table paging and field contracts", () => {
  it("shares a 50-row default and clamps page bounds, empty results and size changes", () => {
    expect(FOLLOWUP_DEFAULT_PAGE_SIZE).toBe(50); expect(FOLLOWUP_PAGE_SIZES).toEqual([20, 50, 100]);
    for (const size of [undefined, null, "", 0, 49, "invalid", []]) expect(followupPageSize(size)).toBe(50);
    expect(followupPageSize(["100"])).toBe(100);
    const rows = Array.from({ length: 101 }, (_, id) => id);
    expect(followupPage(rows, 1, 50).rows).toHaveLength(50);
    expect(followupPage(rows, 2, 50).rows).toEqual(rows.slice(50, 100));
    expect(followupPage(rows, 99, 50)).toMatchObject({ rows: [100], page: 3, count: 101 });
    expect(followupPage(rows, -1, 50).page).toBe(1); expect(followupPage(rows, NaN, 50).page).toBe(1);
    expect(followupPage([], 9, 50)).toMatchObject({ page: 1, totalPages: 1, rows: [] });
  });
  it("filters the permission-scoped collection before counting, sorting and returning one page", () => {
    const fields = leadIntakeTableFields(t, t, t);
    const rows = Array.from({ length: 125 }, (_, id) => lead(`row-${id}`, { gradeHint: id < 70 ? 3 : 4 }));
    const result = followupFieldPage(rows, fields, query({ grade: enumFilter("4") }), context, 2, 50);
    expect(result).toMatchObject({ page: 2, count: 55, pageSize: 50 });
    expect(result.rows.map(row => row.id)).toEqual(rows.slice(120).map(row => row.id));
    expect(result.fieldView.facets.grade.options.map(option => option.value)).toEqual(["3", "4"]);
    const scoped = followupFieldPage(rows.slice(70), fields, query({}), context, 1, 50);
    expect(scoped.fieldView.facets.grade.options.map(option => option.value)).toEqual(["4"]);
    expect(scoped.rows).toHaveLength(50);
    expect(scoped.fieldView.facets.name.options).toEqual([]); expect(scoped.fieldView.facets.phone.options).toEqual([]);
    const sorted = followupFieldPage(rows, fields, { ...query({ grade: enumFilter("4") }), sort: { field: "name", direction: "desc" } }, context, 1, 50);
    expect(sorted.rows[0].id).toBe("row-124");
  });
  it("allowlists field IDs, query versions and bounded serialized input", () => {
    const fields = leadIntakeTableFields(t, t, t);
    expect(parseFollowupFieldQuery(fields, "invalid")).toEqual(query({}));
    expect(parseFollowupFieldQuery(fields, " ".repeat(16_385))).toEqual(query({}));
    expect(parseFollowupFieldQuery(fields, { version: 2, filters: { name: textFilter("Sample"), sql: textFilter("select") }, sort: { field: "sql", direction: "asc" } })).toEqual(query({ name: textFilter("Sample") }));
  });
  it("preserves the backend assessment order, including undated and materialized identities", () => {
    const rows = [{ id: "undated" }, { id: "older" }, { id: "invitation:latest" }];
    expect(assessmentSourceOrder(rows, [{ id: "invitation:latest" }, { id: "older" }, { id: "undated" }]).map(row => row.id)).toEqual(["invitation:latest", "older", "undated"]);
    expect(rows.map(row => row.id)).toEqual(["undated", "older", "invitation:latest"]);
    expect(() => assessmentSourceOrder(rows, [{ id: "older" }])).toThrow("ASSESSMENT_SOURCE_ORDER_INCOMPLETE");
    const reader = readFileSync(new URL("../src/features/school/assessment-workbench-data.ts", import.meta.url), "utf8");
    expect(reader).toContain('.order("assessment_at", { ascending: false, nullsFirst: false })');
    expect(reader).toContain("return assessmentSourceOrder(");
    const migration = readFileSync(new URL("../supabase/migrations/20260907001200_assessment_workbench_read_order.sql", import.meta.url), "utf8");
    expect(migration).toContain("security_invoker = true");
    expect(migration).not.toMatch(/\b(?:insert into|update public|delete from)\b/i);
  });
  it("ANDs distinct lead fields, ORs values within a field, and uses canonical owner and grade IDs", () => {
    const rows = [lead("Alpha", { phone: "111", gradeHint: 10 }), lead("Beta", { phone: "222", gradeHint: 2, ownerId: "owner-b" })];
    const fields = leadIntakeTableFields(t, t, t);
    expect(match(rows, fields, { name: textFilter("Alpha"), phone: textFilter("222") })).toEqual([]);
    expect(match(rows, fields, { interest: enumFilter("Coding", "Other"), owner: enumFilter("owner-a") })).toEqual([rows[0]]);
    expect(match(rows, fields, { acquiredAt: { kind: "date", from: "2026-09-06", to: "2026-09-06" } })).toHaveLength(2);
    expect(filterAndSortDashboardFields(rows, fields, { ...query({}), sort: { field: "grade", direction: "asc" } }, "en", context.timeZone)).toEqual([rows[1], rows[0]]);
  });
});

describe("related placement and communication facts", () => {
  const classroom = (id: string, teacher: string, sessions: PlacementClassroom["sessions"]): PlacementClassroom => ({ id, name: id,
    courseId: `course-${id}`, termId: "term", capacity: 10, activeCount: 0, operationalStatus: "active", teacherNames: teacher,
    teachers: [{ id: teacher, name: "Same display name" }], sessions });
  const a = classroom("a", "teacher-a", [{ at: "2026-09-07T01:00:00Z", duration: 60 }, { at: "2026-09-08T02:00:00Z", duration: 60 }]);
  const b = classroom("b", "teacher-b", [{ at: "2026-09-07T02:00:00Z", duration: 90 }]);
  const board: EnrollmentPlacementBoard = { options: { terms: [], courses: [], classrooms: [a, b] }, enrollments: [], members: [] };
  const row: PlacementRosterRow = { key: "pending", group: "term:3", grade: 3, termId: "term", classroom: null, classrooms: [a, b], students: [] };
  const fields = placementTableFields(board, "en", context.timeZone, t, () => ({ names: "", phones: "" }));
  it("requires teacher, classroom, weekday and time to belong to the same class and session", () => {
    expect(match([row], fields, { classroom: enumFilter("a"), teacher: enumFilter("teacher-b") })).toEqual([]);
    expect(match([row], fields, { teacher: enumFilter("teacher-a"), weekday: enumFilter("1"), startTime: textFilter("10:00") })).toEqual([]);
    expect(match([row], fields, { teacher: enumFilter("teacher-a"), weekday: enumFilter("2"), startTime: textFilter("10:00"), endTime: textFilter("11:00") })).toEqual([row]);
    const facets = dashboardFieldFacets([row], fields, { classroom: enumFilter("a") }, "en", context.timeZone);
    expect(facets.teacher.options.map(option => option.value)).toEqual(["teacher-a"]);
  });
  it("does not combine one student's name with another student's phone in the same class", () => {
    const student = (name: string, phone: string): PlacementStudent => ({ key: name, studentId: name, name, phone, grade: 3,
      enrollmentId: null, membershipId: null, courseId: "course-a", courseTitle: "Math", termId: "term", classroomId: "a", note: "", recommendation: "", seat: null, status: "active" });
    const group = { ...row, classroom: a, students: [student("Alpha", "111"), student("Beta", "222")] };
    expect(match([group], fields, { student: textFilter("Alpha"), phone: textFilter("222") })).toEqual([]);
    expect(match([group], fields, { student: textFilter("Beta"), phone: textFilter("222") })).toEqual([group]);
  });
  it("filters historical day outcomes, channel and note from the same effective event", () => {
    const person = lead("lead");
    const workday: CommunicationWorkday = { date: "2026-09-07", tasks: [], events: [
      { id: "one", key: "lead:lead", source: "contact", channel: "phone", outcome: "connected", note: "Math", occurredAt: "2026-09-07T01:00:00Z", recordedAt: "2026-09-07T01:00:00Z", recordedById: "owner", recordedByName: "Owner", revisionId: null, revisedAt: null, canRevise: false },
      { id: "two", key: "lead:lead", source: "contact", channel: "wechat", outcome: "no_answer", note: "Later", occurredAt: "2026-09-07T02:00:00Z", recordedAt: "2026-09-07T02:00:00Z", recordedById: "owner", recordedByName: "Owner", revisionId: null, revisedAt: null, canRevise: false },
    ] };
    const eventFields = communicationTableFields({ locale: "en", t, leadT: t, enrollmentT: t, tableT: t, workT: t, leads: new Map([[person.id, person]]), workday, recordsMode: true });
    const eventRow: CommunicationTableRow = { id: "contact:lead", source: "contact", value: person };
    expect(match([eventRow], eventFields, { channel: enumFilter("phone"), contactOutcome: enumFilter("no_answer") })).toEqual([]);
    expect(match([eventRow], eventFields, { channel: enumFilter("phone"), contactOutcome: enumFilter("connected"), note: textFilter("Math") })).toEqual([eventRow]);
    const facets = dashboardFieldFacets([eventRow], eventFields, { channel: enumFilter("phone") }, "en", context.timeZone);
    expect(facets.contactOutcome.options.map(option => option.value)).toEqual(["connected"]);
    expect(facets.recordedAt.days).toEqual(["2026-09-07"]);
  });
});

describe("typed renewal facts", () => {
  it("keeps zero amounts, missing facts, season ordering and separate owner IDs", () => {
    const fields = renewalTableFields({ locale: "en", now: context.now, t, pool: t, resultFor: row => row.stage, labelFor: row => row.stage, healthFor: () => null, observationFor: () => "" });
    const row: RenewalPoolRow = { id: "a", membershipId: "a", studentId: "a", name: "Alpha", phone: "", grade: 3, classroom: "Class", teacher: "Teacher", owner: "Owner", ownerId: "owner-a", stage: "considering", note: "", opportunityId: "a", targetCourse: "", nextContactAt: null, updatedAt: "2026-09-07T01:00:00Z",
      payment: { opportunity_id: "a", paid_amount: 0, period_count: 1, note: "" }, record: { opportunityId: "a", revision: 1, contactMethod: "phone", seasons: ["autumn", "spring"], paidOn: "2026-09-06", paymentMethod: "cash", updatedAt: "2026-09-07T01:00:00Z" } };
    const other = { ...row, id: "b", ownerId: "owner-b", payment: undefined, record: { ...row.record!, seasons: ["winter" as const] } };
    expect(match([row, other], fields, { amount: { kind: "number", min: 0, max: 0 } })).toEqual([row]);
    expect(match([row, other], fields, { health: { kind: "presence", value: "missing" } })).toHaveLength(2);
    expect(match([row, other], fields, { owner: enumFilter("owner-b") })).toEqual([other]);
    expect(filterAndSortDashboardFields([row, other], fields, { ...query({}), sort: { field: "seasons", direction: "asc" } }, "en", context.timeZone)).toEqual([other, row]);
    expect(match([row], fields, { paidOn: { kind: "date", from: "2026-09-06", to: "2026-09-06" }, seasons: enumFilter("spring") })).toEqual([row]);
  });
});
