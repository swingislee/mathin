import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStudent360Action } from "@/features/school/actions/student-360";

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/school/student-360", () => ({ getStudent360Snapshot: state.read }));
const studentId = "00000000-0000-4000-8000-000000000001";
const leadId = "00000000-0000-4000-8000-000000000002";

beforeEach(() => { state.read.mockReset().mockResolvedValue({ lifecycleStage: "awaiting_assessment" }); });

describe("student 360 subject action", () => {
  it.each([{ studentId, leadId: null }, { studentId: null, leadId }, { studentId, leadId }])(
    "accepts a valid subject, including the linked pair sent after automatic profile creation", async (subject) => {
      expect((await getStudent360Action(subject)).ok).toBe(true);
      expect(state.read).toHaveBeenCalledWith(subject);
    },
  );
  it("rejects an empty subject before querying", async () => {
    expect(await getStudent360Action({ studentId: null, leadId: null })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(state.read).not.toHaveBeenCalled();
  });
  it("accepts persisted import UUIDs without changing their identity", async () => {
    const subject = { studentId: null, leadId: "abcdef01-2345-abcd-cdef-0123456789ab" };
    expect(await getStudent360Action(subject)).toMatchObject({ ok: true });
    expect(state.read).toHaveBeenCalledWith(subject);
  });
  it.each(["not-an-id", "abcdef01-2345-abcd-cdef-0123456789az", "abcdef012345abcdcdef0123456789ab", "abcdef01-2345-abcd-cdef-0123456789ab' OR true"])("rejects malformed input %s before querying", async (value) => {
    expect(await getStudent360Action({ studentId: null, leadId: value })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(state.read).not.toHaveBeenCalled();
  });
  it.each(["SUBJECT_MISMATCH", "FORBIDDEN_SCOPE"])("preserves the server-side %s boundary", async (code) => {
    state.read.mockRejectedValue(new Error(code));
    expect(await getStudent360Action({ studentId, leadId })).toMatchObject({
      ok: false, code: code === "FORBIDDEN_SCOPE" ? "FORBIDDEN" : code,
    });
  });
});
