import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ quick: vi.fn(), records: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/classes", () => ({ getSessionQuickRow: deps.quick }));
vi.mock("@/features/school/teaching-workbench/teaching-records-read", () => ({ getTeachingRecords: deps.records }));
vi.mock("@/lib/supabase/server", () => ({ createClient: deps.client }));
import { getClassSessionDetail } from "@/features/school/class-roster-session-read";
beforeEach(() => { vi.resetAllMocks(); });
describe("课次展开按真实状态与能力分流", () => {
  it("课前直接返回原课次能力，不读取课后记录或生成空记录", async () => {
    deps.quick.mockResolvedValue({ classroomId: "class", state: "scheduled", capabilities: { canOpenManagement: true, canPrepare: true, canEnterLive: true, canMarkAttendance: false } });
    expect(await getClassSessionDetail("lesson", "class", "teacher", true)).toEqual({ stage: "pre", canPrepare: true, canEnterLive: true, canMarkAttendance: false });
    expect(deps.records).not.toHaveBeenCalled(); expect(deps.client).not.toHaveBeenCalled();
  });
  it("只读角色保留只读能力", async () => {
    deps.quick.mockResolvedValue({ classroomId: "class", state: "scheduled", capabilities: { canOpenManagement: true, canPrepare: false, canEnterLive: false, canMarkAttendance: false } });
    expect(await getClassSessionDetail("lesson", "class", "viewer", false)).toMatchObject({ canPrepare: false, canEnterLive: false, canMarkAttendance: false });
  });
  it.each([null, { classroomId: "other", state: "scheduled", capabilities: { canOpenManagement: true } },
    { classroomId: "class", state: "scheduled", capabilities: { canOpenManagement: false } },
    { classroomId: "class", state: "scheduled", deletedAt: "2026-09-25T00:00:00Z", capabilities: { canOpenManagement: true } },
    { classroomId: "class", state: "cancelled", capabilities: { canOpenManagement: true } }])("失效或不匹配的课次不读取学情", async quick => {
    deps.quick.mockResolvedValue(quick);
    await expect(getClassSessionDetail("lesson", "class", "viewer", true)).rejects.toThrow("SESSION_NOT_FOUND");
    expect(deps.records).not.toHaveBeenCalled();
  });
});
