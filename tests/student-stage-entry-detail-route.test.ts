import { beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({ detail: vi.fn(), options: vi.fn() }));
vi.mock("@/features/school/student-stage-actions", () => ({ getStudentStageSubjectAction: readers.detail, getStudentStageOptionsAction: readers.options }));
import { POST as detailPOST } from "@/app/[locale]/dashboard/students/entry-detail/route";
import { POST as optionsPOST } from "@/app/[locale]/dashboard/students/entry-options/route";

const request = (body: string) => new Request("http://example.test/zh/dashboard/students/entry-detail", { method: "POST", body });
describe.each([
  { name: "detail", POST: detailPOST, read: readers.detail },
  { name: "options", POST: optionsPOST, read: readers.options },
])("student $name transport", ({ POST, read }) => {
  beforeEach(() => read.mockReset());
  it("reuses the authorized reader and returns uncached detail", async () => {
    const input = { studentId: "student", leadId: null };
    const result = { ok: true, data: { key: "student:student" } };
    read.mockResolvedValue(result);
    const response = await POST(request(JSON.stringify(input)));
    expect(read).toHaveBeenCalledWith(input);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects malformed JSON before reading", async () => {
    expect((await POST(request("{"))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["VALIDATION", "UNAUTHENTICATED", "FORBIDDEN", "FORBIDDEN_SCOPE", "SUBJECT_MISMATCH"])("preserves %s", async code => {
    read.mockResolvedValue({ ok: false, code });
    expect(await (await POST(request("{}"))).json()).toEqual({ ok: false, code });
  });
});
