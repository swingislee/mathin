import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStudentStageFieldPage } from "@/features/school/student-stage-table-data";
import { studentStageFieldsAcrossStages, studentStageTableFields } from "@/features/school/student-stage-table-fields";
import { parseStudentStageFilters, studentStageHref, type StudentStageFilters, type StudentStageRow } from "@/features/school/student-stage-contract";
import type { DashboardFieldFilters } from "@/features/school/dashboard-page/dashboard-table-field-contract";

const source = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/student-list-query-data", () => ({ loadStudentListQueryPage: () => { throw new Error("EXPECTED_RECONTACT_PATH"); } }));
vi.mock("@/features/school/student-stage-data", () => ({ loadStudentRecordSummaries: source }));
const context = { locale: "zh", timeZone: "Asia/Shanghai", now: Date.parse("2026-09-08T01:00:00Z") };
const base: StudentStageFilters = { stage: "awaiting_first_contact", population: "recontact", scope: "all", detail: "", q: "", page: 1, pageSize: 50 };
const row = (index: number, extra: Partial<StudentStageRow> = {}): StudentStageRow => ({ key: `student:${index}`, studentId: String(index), leadId: null,
  name: `学生${index}`, phone: `phone-${index}`, grade: index < 100 ? 3 : 4, gradeText: "", ownerId: index < 100 ? "owner-a" : "owner-b", ownerName: "同名负责人",
  stage: "awaiting_first_contact", detail: "not_contacted", note: index < 100 ? "" : "全名单匹配", lastContactAt: index < 100 ? null : "2026-09-07T16:30:00Z", nextContactAt: null,
  score: null, assessmentBand: null, assessmentAt: null, registrationId: null, courseTitle: "", termName: "", courseId: null, termId: null,
  createdAt: "2026-09-07T12:00:00Z", canWrite: true, canContact: true, invitation: null, ...extra });
const query = (filters: DashboardFieldFilters) => ({ version: 2 as const, filters, sort: null });
const encoded = (filters: DashboardFieldFilters) => JSON.stringify(query(filters));

beforeEach(() => {
  vi.clearAllMocks();
  const rows = Array.from({ length: 165 }, (_, index) => row(index));
  source.mockImplementation(async () => ({ rows, counts: { awaiting_first_contact: rows.length } }));
});

describe("recontact lists keep the shared field query before pagination", () => {
  it("finds and sorts records beyond the first source page, and exposes full-scope facets", async () => {
    const result = await loadStudentStageFieldPage({ ...base, page: 2, fields: JSON.stringify({ ...query({ grade: { kind: "enum", values: ["4"] } }), sort: { field: "name", direction: "desc" } }) }, context, "owner-a");
    expect(source).toHaveBeenCalledTimes(1);
    expect(source.mock.calls[0][0].detail).toBe("");
    expect(result).toMatchObject({ count: 65, page: 2, totalPages: 2 });
    expect(result.rows.map(value => value.key)).toEqual(Array.from({ length: 15 }, (_, index) => `student:${114 - index}`));
    expect(result.fieldView.facets.grade.options.map(option => option.value)).toEqual(["3", "4"]);
    expect(result.fieldView.facets.name.options).toEqual([]);
    expect(result.fieldView.facets.phone.options).toEqual([]);
  });
  it("combines text, canonical owner IDs, presence and organization-day ranges", async () => {
    const result = await loadStudentStageFieldPage({ ...base, fields: encoded({ note: { kind: "text", query: "全名单" },
      owner: { kind: "enum", values: ["owner-b"] }, lastContactAt: { kind: "date", from: "2026-09-08", to: "2026-09-08" } }) }, context, "owner-a");
    expect(result.count).toBe(65); expect(result.rows.every(value => value.ownerId === "owner-b")).toBe(true);
    const missing = await loadStudentStageFieldPage({ ...base, fields: encoded({ lastContactAt: { kind: "presence", value: "missing" } }) }, context, "owner-a");
    expect(missing.count).toBe(100);
  });
  it("keeps legacy responsibility scope and lets the common menu explicitly switch to all", async () => {
    const mine = await loadStudentStageFieldPage({ ...base, scope: "mine" }, context, "owner-a");
    expect(source.mock.calls[0][0].scope).toBe("mine"); expect(mine.count).toBe(100);
    expect(mine.fieldView.facets.scope.options.map(option => option.value)).toEqual(["all", "mine", "unassigned"]);
    source.mockClear();
    await loadStudentStageFieldPage({ ...base, scope: "mine", fields: encoded({}) }, context, "owner-a");
    expect(source.mock.calls[0][0].scope).toBe("all");
  });
  it("preserves field queries in page links and clears stage-specific state when changing tabs", () => {
    const fields = { ...query({ detail: { kind: "enum", values: ["not_contacted"] }, owner: { kind: "enum", values: ["owner-a"] } }), sort: { field: "name", direction: "asc" as const } };
    const next = studentStageFieldsAcrossStages(fields);
    expect(JSON.parse(next)).toEqual({ ...fields, filters: { owner: fields.filters.owner } });
    const url = new URL(studentStageHref({ ...base, fields: next }, { page: 3 }), "http://test.invalid");
    expect(parseStudentStageFilters(Object.fromEntries(url.searchParams))).toMatchObject({ page: 3, fields: next });
    for (const stage of ["awaiting_first_contact", "awaiting_assessment"] as const) expect(studentStageTableFields("zh", stage, "owner-a").assessmentAt).toBeUndefined();
    expect(studentStageTableFields("en", "awaiting_enrollment", "owner-a").assessmentAt.kind).toBe("date");
  });
  it("propagates a failed summary read instead of presenting an incomplete list", async () => {
    source.mockRejectedValueOnce(new Error("STAGE_READ_FAILED"));
    await expect(loadStudentStageFieldPage(base, context, "owner-a")).rejects.toThrow("STAGE_READ_FAILED");
  });
});
