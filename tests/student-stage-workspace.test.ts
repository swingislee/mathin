import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultStudentEntryMode, parseStudentStageFilters, replaceSavedStudent, STUDENT_STAGE_DETAILS, STUDENT_STAGE_TABS,
  studentStageHref, type StudentStageEntryInput, type StudentStageRow,
} from "@/features/school/student-stage-contract";
import { studentStageMessages } from "@/features/school/student-stage-messages";

const fixture = vi.hoisted(() => ({ user: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
  permissions: new Set(["followup.write"]), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidate }));
vi.mock("@/lib/auth", () => ({ getMyPerms: async () => fixture.permissions }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fixture.user } }) }, rpc: fixture.rpc,
}) }));
import { saveStudentStageEntryAction } from "@/features/school/student-stage-actions";
import { loadStudentStageData } from "@/features/school/student-stage-data";

const id = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const row: StudentStageRow = {
  key: `student:${id}`, studentId: id, leadId: null, name: "Student", phone: "", grade: null, gradeText: "",
  ownerId: null, ownerName: "", stage: "awaiting_assessment", detail: "no_show", note: "", lastContactAt: null,
  nextContactAt: null, score: null, assessmentBand: null, assessmentAt: null, registrationId: null,
  courseTitle: "", termName: "", courseId: null, termId: null, createdAt: "2026-09-07T12:00:00Z", canWrite: true,
  canContact: true, invitation: null,
};
const input: StudentStageEntryInput = { studentId: id, leadId: null, mode: "note", note: "Contact later", nextContactAt: null,
  outcome: null, wechatAdded: null, interestLevel: null, invitation: null, expectedInvitationId: null,
  expectedInvitationUpdatedAt: null, enrollment: null };
const saved = { subject: row, savedAt: row.createdAt, opportunityId: null, enrollmentId: null };

describe("student stage navigation and row continuity", () => {
  it("normalizes stage filters and makes a name search independent of stage details", () => {
    const filters = parseStudentStageFilters({ stage: ["awaiting_assessment"], detail: "no_show", q: "  姓名  ", scope: "all", page: "2", pageSize: "50" });
    expect(filters).toEqual({ stage: "awaiting_assessment", detail: "", q: "姓名", scope: "all", page: 2, pageSize: 50 });
    const href = studentStageHref(filters, { page: 3 });
    expect(parseStudentStageFilters(Object.fromEntries(new URL(href, "https://example.test").searchParams))).toEqual({ ...filters, page: 3 });
    expect(parseStudentStageFilters({ stage: "missing", detail: "no_show", page: "NaN", pageSize: "200" }, "all"))
      .toEqual({ stage: "awaiting_first_contact", detail: "", q: "", scope: "all", page: 1, pageSize: 50 });
    expect(parseStudentStageFilters({ stage: "former_student", detail: "withdrawn" }).detail).toBe("withdrawn");
  });
  it("replaces the linked identity at the original position and removes its duplicate", () => {
    const lead = { ...row, key: "lead:lead-id", studentId: null, leadId: "lead-id", stage: "awaiting_first_contact" as const };
    const next = { ...row, key: "student:next" };
    const rows = [lead, next, row];
    const result = replaceSavedStudent(rows, lead.key, row);
    expect(result.map(item => item.key)).toEqual([row.key, next.key]);
    expect(rows).toHaveLength(3);
    expect(replaceSavedStudent(result, row.key, { ...row, stage: "awaiting_renewal" })[0].stage).toBe("awaiting_renewal");
    expect(defaultStudentEntryMode(lead)).toBe("contact");
    expect(defaultStudentEntryMode(row)).toBe("note");
  });
  it("provides both languages for every selectable main stage and situation", () => {
    expect(STUDENT_STAGE_TABS).toHaveLength(5);
    for (const locale of ["zh", "en"]) {
      const messages = studentStageMessages(locale);
      for (const stage of STUDENT_STAGE_TABS) {
        expect(messages.stages[stage]).toBeTruthy();
        for (const detail of STUDENT_STAGE_DETAILS[stage]) expect(messages.details[detail]).toBeTruthy();
      }
    }
  });
});

describe("student entry action and page contract", () => {
  beforeEach(() => {
    fixture.user = { id: "00000000-0000-4000-8000-000000000001" };
    fixture.permissions = new Set(["followup.write"]);
    fixture.rpc.mockReset(); fixture.revalidate.mockReset();
    fixture.rpc.mockResolvedValue({ data: saved, error: null });
  });
  it("saves a standalone note with no appointment, result, course or reminder", async () => {
    expect(await saveStudentStageEntryAction(requestId, input)).toEqual({ ok: true, data: saved });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("save_student_stage_entry", { p_request_id: requestId, p_payload: input });
    expect(fixture.revalidate).toHaveBeenCalledWith("/[locale]/dashboard/students", "page");
  });
  it("rejects anonymous, read-only and incomplete entries before writing", async () => {
    fixture.user = null;
    expect(await saveStudentStageEntryAction(requestId, input)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    fixture.user = { id }; fixture.permissions = new Set(["followup.view"]);
    expect(await saveStudentStageEntryAction(requestId, input)).toEqual({ ok: false, code: "FORBIDDEN" });
    fixture.permissions = new Set(["followup.write"]);
    for (const invalid of [{ ...input, note: " " }, { ...input, mode: "contact" as const }, { ...input, mode: "invitation" as const },
      { ...input, studentId: null }, { ...input, mode: "enrollment" as const, enrollment: {
        courseId: id, termId: id, type: "new" as const, stage: "committed" as const, confirm: true, paymentEvidence: "", expectedOpportunityId: null,
      } }]) expect(await saveStudentStageEntryAction(requestId, invalid)).toEqual({ ok: false, code: "VALIDATION" });
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("keeps the request identity across retries and returns a conflict without invalidating the page", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "INVITATION_CONFLICT" } });
    for (let attempt = 0; attempt < 2; attempt++) expect(await saveStudentStageEntryAction(requestId, input)).toEqual({ ok: false, code: "INVITATION_CONFLICT" });
    expect(fixture.rpc.mock.calls.map(([, args]) => args.p_request_id)).toEqual([requestId, requestId]);
    expect(fixture.revalidate).not.toHaveBeenCalled();
  });
  it("sends scope and filters to the database before pagination and validates returned rows", async () => {
    const filters = parseStudentStageFilters({ stage: "awaiting_assessment", detail: "no_show", page: "3", pageSize: "50" });
    const page = { rows: [row], counts: { awaiting_assessment: 101 }, count: 101, page: 3, pageSize: 50, totalPages: 3 };
    fixture.rpc.mockResolvedValueOnce({ data: page, error: null });
    expect(await loadStudentStageData(filters)).toEqual(page);
    expect(fixture.rpc).toHaveBeenCalledWith("list_student_stage_workspace", {
      p_stage: "awaiting_assessment", p_scope: "mine", p_search: "", p_page: 3, p_page_size: 50, p_detail: "no_show",
    });
    fixture.rpc.mockResolvedValueOnce({ data: { ...page, rows: [{ ...row, stage: "unknown" }] }, error: null });
    await expect(loadStudentStageData(filters)).rejects.toThrow();
  });
});
