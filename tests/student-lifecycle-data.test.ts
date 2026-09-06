import { describe, expect, it, vi } from "vitest";
import { readStudentLifecycle } from "@/features/school/student-lifecycle-data";

vi.mock("server-only", () => ({}));
vi.mock("@/features/school/actions/guards", () => ({ nullableRpcArg: (value: unknown) => value }));

describe("student lifecycle read", () => {
  it("passes only the explicit subject to the read-only RPC and preserves SQL nulls", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "awaiting_renewal", error: null });
    const client = { rpc } as unknown as Parameters<typeof readStudentLifecycle>[0];
    expect(await readStudentLifecycle(client, { studentId: "student", leadId: null })).toBe("awaiting_renewal");
    expect(rpc).toHaveBeenCalledWith("get_student_lifecycle", { p_student_id: "student", p_lead_id: null });
  });

  it("surfaces scope and malformed contract errors rather than inventing a lower stage", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "FORBIDDEN_SCOPE" } })
      .mockResolvedValueOnce({ data: "awaiting_class", error: null });
    const client = { rpc } as unknown as Parameters<typeof readStudentLifecycle>[0];
    await expect(readStudentLifecycle(client, { studentId: null, leadId: "lead" })).rejects.toThrow("FORBIDDEN_SCOPE");
    await expect(readStudentLifecycle(client, { studentId: null, leadId: "lead" })).rejects.toThrow("INVALID_STUDENT_LIFECYCLE");
  });
});
