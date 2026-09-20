import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStudentStageFieldPage } from "@/features/school/student-stage-table-data";
import type { StudentStageFilters } from "@/features/school/student-stage-contract";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
const filters: StudentStageFilters = { stage: "awaiting_renewal", scope: "mine", q: "", detail: "", page: 3, pageSize: 20 };
const context = { locale: "en", timeZone: "Asia/Shanghai", now: Date.parse("2026-09-08T00:00:00Z") };
const row = { key: "student:1", studentId: "1", leadId: null, name: "Student", phone: "", grade: null, gradeText: "", ownerId: null, ownerName: "",
  stage: "awaiting_renewal", detail: "attending", note: "", lastContactAt: null, nextContactAt: null, score: null, assessmentBand: null, assessmentAt: null,
  registrationId: null, courseTitle: "", termName: "", courseId: null, termId: null, createdAt: "2026-09-08T00:00:00Z", canWrite: true, canContact: true,
  invitation: null, detailLoaded: false };
const page = { rows: [row], counts: { awaiting_renewal: 125 }, count: 41, page: 3, pageSize: 20, totalPages: 3,
  facets: { owner: { options: [{ value: "owner-b", label: "同名" }, { value: "owner-a", label: "同名" }], days: [] } } };
beforeEach(() => { vi.clearAllMocks(); rpc.mockImplementation(async (name: string) => ({ data: name === "read_school_record_hints" ? [{ key: row.key, possibleDuplicateCount: 1 }] : page, error: null })); });

describe("student list database page adapter", () => {
  it("omits unused duplicate hints for an embedded contact list while retaining paging and permissions", async () => {
    rpc.mockResolvedValueOnce({ data: { ...page, facets: {} }, error: null });
    const result = await loadStudentStageFieldPage(filters, context, "actor", { includeRecordHints: false, includeFieldFacets: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_student_records_page", expect.objectContaining({ p_query: expect.objectContaining({ includeFacets: false }) }));
    expect(result).toMatchObject({ count: page.count, page: page.page, rows: [{ canWrite: true, canContact: true }] });
    expect(result.rows[0].possibleDuplicateCount).toBeUndefined();
    expect(result.fieldView.facets.scope.options.map(option => option.value)).toEqual(["all", "mine", "group", "unassigned"]);
  });
  it("requests one page and keeps database totals, detail marker and scope menu", async () => {
    const result = await loadStudentStageFieldPage(filters, context, "actor");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("read_school_record_hints", { p_subjects: [{ studentId: row.studentId, leadId: null }] });
    expect(rpc).toHaveBeenCalledWith("list_student_records_page", expect.objectContaining({ p_scope: "mine", p_population: "work", p_page: 3, p_page_size: 20, p_locale: "en" }));
    expect(result).toMatchObject({ count: 41, page: 3, totalPages: 3, rows: [{ detailLoaded: false, possibleDuplicateCount: 1 }], counts: { awaiting_renewal: 125 } });
    expect(result.fieldView?.facets.scope.options.map(option => option.value)).toEqual(["all", "mine", "group", "unassigned"]);
    expect(result.fieldView?.facets.owner.options.map(option => option.label)).toEqual(["同名 · owner-b", "同名 · owner-a"]);
  });
  it("normalizes field input, passes translated labels and retains the search population", async () => {
    const fields = JSON.stringify({ version: 2, filters: { note: { kind: "text", query: "  Alpha  " }, unknown: { kind: "text", query: "x" } }, sort: { field: "name", direction: "desc" } });
    const result = await loadStudentStageFieldPage({ ...filters, population: "records", q: "Student", fields }, context, "actor");
    expect(rpc).toHaveBeenCalledWith("list_student_records_page", expect.objectContaining({ p_scope: "all", p_search: "Student", p_population: "records",
      p_query: { version: 2, filters: { note: { kind: "text", query: "Alpha" } }, sort: { field: "name", direction: "desc" } },
      p_labels: expect.objectContaining({ detail: expect.objectContaining({ attending: expect.any(String) }) }) }));
    expect(result.fieldView?.query.filters.note).toEqual({ kind: "text", query: "  Alpha  " });
  });
  it("rejects failed or malformed pages without showing partial results", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "FORBIDDEN" } });
    await expect(loadStudentStageFieldPage(filters, context, "actor")).rejects.toThrow("FORBIDDEN");
    rpc.mockResolvedValueOnce({ data: { ...page, rows: [{ key: "incomplete" }] }, error: null });
    await expect(loadStudentStageFieldPage(filters, context, "actor")).rejects.toThrow();
  });
  it("pages recontact on the database and preserves reason counts and the group filter", async () => {
    rpc.mockResolvedValueOnce({ data: { ...page, reasonCounts: { dormant: 2438, assessed: 157 } }, error: null });
    const result = await loadStudentStageFieldPage({ ...filters, population: "recontact", reason: "dormant", scope: "group" }, context, "actor");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_student_recontact_page", expect.objectContaining({ p_scope: "group", p_reason: "dormant", p_page: 3, p_page_size: 20,
      p_query: { version: 2, filters: { scope: { kind: "enum", values: ["group"] } }, sort: null } }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_population");
    expect(result.reasonCounts).toEqual({ dormant: 2438, assessed: 157 });
    expect(result.count).toBe(41);
  });
  it("uses the recontact reason's visible fields when normalizing filters", async () => {
    const fields = JSON.stringify({ version: 2, filters: { teacher: { kind: "presence", value: "present" }, note: { kind: "text", query: " abc " } }, sort: null });
    await loadStudentStageFieldPage({ ...filters, population: "recontact", reason: "unreachable", fields }, context, "actor");
    expect(rpc).toHaveBeenCalledWith("list_student_recontact_page", expect.objectContaining({ p_reason: "unreachable",
      p_query: { version: 2, filters: { note: { kind: "text", query: "abc" } }, sort: null } }));
  });
});
