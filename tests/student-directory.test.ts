import { beforeEach, describe, expect, it, vi } from "vitest";
import { directoryContactHref, directoryReturnHref, directorySelectionSchema, groupDirectoryCards, parseStudentDirectoryFilters,
  studentDirectoryHref, toStudentDirectoryCard } from "@/features/school/student-directory-contract";
import type { StudentStageRow } from "@/features/school/student-stage-contract";

const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
import { loadDirectoryContactSelection, loadStudentDirectory } from "@/features/school/student-directory-data";

const id = "00000000-0000-4000-8000-000000000011", otherId = "00000000-0000-4000-8000-000000000012";
const row: StudentStageRow & { directoryGroups: { id: string; name: string }[] } = {
  key: `student:${id}`, studentId: id, leadId: null, name: "学生样例", phone: "13800001234", grade: 3, gradeText: "",
  ownerId: null, ownerName: "", stage: "awaiting_enrollment", detail: "assessed", note: "Private note", lastContactAt: null,
  nextContactAt: null, score: null, assessmentBand: null, assessmentAt: null, registrationId: null,
  courseTitle: "", termName: "", courseId: null, termId: null, createdAt: "2026-09-07T12:00:00Z", canWrite: true,
  canContact: true, invitation: null, directoryGroups: [{ id: "class-a", name: "3班" }, { id: "class-b", name: "4班" }],
};
const page = { rows: [row], count: 1, page: 1, totalPages: 1, pageSize: 100, groups: [], counts: { awaiting_enrollment: 1 } };

beforeEach(() => { fixture.rpc.mockReset(); fixture.rpc.mockResolvedValue({ data: page, error: null }); });

describe("student directory boundaries", () => {
  it("keeps profiles distinct from pure leads and sends only a phone tail to cards", () => {
    expect(toStudentDirectoryCard({ ...row, studentId: null, leadId: id })).toBeNull();
    const card = toStudentDirectoryCard(row)!;
    expect(card).toMatchObject({ id, phoneTail: "1234", assessment: null });
    expect(card).not.toHaveProperty("phone");
    expect(card).not.toHaveProperty("note");
    expect(toStudentDirectoryCard({ ...row, leadId: otherId })?.id).toBe(id);
  });
  it("shows actual assessment records without presenting class-band inference as assessment", () => {
    expect(toStudentDirectoryCard({ ...row, assessmentSource: "class_band", assessmentBand: "a", score: 90 })?.assessment).toBeNull();
    expect(toStudentDirectoryCard({ ...row, assessmentSource: "assessment", assessmentBand: "b_plus", assessmentAt: "2026-09-18", score: 75 })?.assessment)
      .toEqual({ band: "b_plus", score: 75, at: "2026-09-18" });
    expect(toStudentDirectoryCard({ ...row, assessmentSource: "assessment" })?.assessment).not.toBeNull();
  });
  it("groups one identity in each membership and restricts an explicit group", () => {
    const card = toStudentDirectoryCard(row)!;
    expect(groupDirectoryCards([card], "", "zh").map(group => group.students[0].id)).toEqual([id, id]);
    expect(groupDirectoryCards([card], "class-b", "zh").map(group => group.id)).toEqual(["class-b"]);
  });
  it("normalizes directory filters and drops former table-state parameters", () => {
    const defaults = parseStudentDirectoryFilters({ population: "work", fields: "old", page: "Infinity", stage: "unknown", pageSize: "200" });
    expect(defaults).toEqual({ scope: "mine", q: "", stage: "all", groupBy: "classroom", group: "", page: 1, pageSize: 100 });
    const filters = parseStudentDirectoryFilters({ scope: "all", q: " 张 ", stage: "awaiting_renewal", groupBy: "grade", group: "3", page: "2", pageSize: "50" });
    expect(parseStudentDirectoryFilters(Object.fromEntries(new URL(studentDirectoryHref(filters), "http://test.invalid").searchParams))).toEqual(filters);
  });
  it("validates and deduplicates the selected list while keeping its order and a local return path", () => {
    const url = new URL(directoryContactHref([otherId, id, otherId], "/dashboard/students?scope=mine&groupBy=grade&group=3"), "http://test.invalid");
    expect(url.pathname).toBe("/dashboard/communication");
    expect(url.searchParams.get("students")).toBe(`${otherId},${id}`);
    expect(url.searchParams.get("returnTo")).toContain("groupBy=grade&group=3");
    for (const ids of [[], ["not-an-id"], Array.from({ length: 101 }, () => id)]) expect(directorySelectionSchema.safeParse(ids).success).toBe(false);
    for (const path of ["https://outside.test", "//outside.test", "/dashboard/students/../settings", "/dashboard/communication"]) expect(directoryReturnHref(path)).toBe("/dashboard/students");
  });
  it("uses server-side filters before paging and projects a minimal client DTO", async () => {
    fixture.rpc.mockResolvedValueOnce({ data: { ...page, rows: [toStudentDirectoryCard(row)] }, error: null });
    const filters = parseStudentDirectoryFilters({ scope: "mine", groupBy: "classroom", group: "class-a", page: "3" });
    const data = await loadStudentDirectory(filters);
    expect(fixture.rpc).toHaveBeenCalledWith("list_student_directory_cards", expect.objectContaining({ p_scope: "mine", p_group_by: "classroom", p_group: "class-a", p_page: 3 }));
    expect(JSON.stringify(data)).not.toContain(row.phone);
    expect(JSON.stringify(data)).not.toContain(row.note);
    expect(data.students[0].phoneTail).toBe("1234");
  });
  it("rejects malformed cards and database errors without retrying the full-record query", async () => {
    const filters = parseStudentDirectoryFilters({ scope: "all" });
    fixture.rpc.mockResolvedValueOnce({ data: { ...page, rows: [{ ...toStudentDirectoryCard(row), phoneTail: row.phone }] }, error: null });
    await expect(loadStudentDirectory(filters)).rejects.toThrow();
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
    fixture.rpc.mockResolvedValueOnce({ data: null, error: { message: "FORBIDDEN" } });
    await expect(loadStudentDirectory(filters)).rejects.toThrow("FORBIDDEN");
    expect(fixture.rpc.mock.calls.every(([name]) => name === "list_student_directory_cards")).toBe(true);
  });
  it("reads exactly the selected identities through the same permission-scoped RPC", async () => {
    await loadDirectoryContactSelection([otherId, id, otherId]);
    expect(fixture.rpc).toHaveBeenCalledWith("list_student_directory", expect.objectContaining({ p_selected: [otherId, id], p_scope: "all", p_stage: "all", p_page_size: 100 }));
    fixture.rpc.mockClear();
    await expect(loadDirectoryContactSelection(["invalid"])).rejects.toThrow();
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
