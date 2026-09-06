import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActivityTargetGradesAction } from "@/features/school/activity-actions";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getMyPerms: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
vi.mock("@/lib/auth", () => ({ getMyPerms: mocks.getMyPerms }));
const id = "00000000-0000-4000-8000-000000000001";

describe("activity target-grade configuration action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "unit-staff" } } });
    mocks.getMyPerms.mockResolvedValue(new Set(["activity.manage"]));
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });
  it.each([null, [], [1, 3, 12]])("preserves unspecified/all/specific scope (%j)", async (grades) => {
    expect(await setActivityTargetGradesAction(id, grades)).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("set_activity_target_grades", { p_activity_id: id, p_target_grades: grades });
  });
  it.each([[0], [13], [1.5], Array(13).fill(1)])("rejects invalid grade lists (%j) before a database call", async (grades) => {
    expect((await setActivityTargetGradesAction(id, grades)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires activity management permission", async () => {
    mocks.getMyPerms.mockResolvedValue(new Set(["followup.write"]));
    expect(await setActivityTargetGradesAction(id, [3])).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires authentication and surfaces save failures", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await setActivityTargetGradesAction(id, [3])).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "unit-staff" } } });
    mocks.rpc.mockResolvedValue({ error: { message: "NOT_FOUND" } });
    expect(await setActivityTargetGradesAction(id, [3])).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
