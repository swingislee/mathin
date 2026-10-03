import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), authorize: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../src/features/school/actions/guards", () => ({
  authorizedClient: mocks.authorize, financeClient: mocks.authorize, nullableRpcArg: (v: unknown) => v,
}));
vi.mock("../src/features/school/class-material", () => ({ getCourseMaterialOptions: vi.fn() }));
import { applyClassroomMaterialChangeAction, getClassroomMaterialWorkspaceAction, previewClassroomMaterialChangeAction, saveCourseMaterialRuleAction } from "../src/features/school/actions/class-material";
import { emptyMaterialSelection } from "../src/features/school/class-material-contract";

const id = "00000000-0000-0000-0000-000000000001";
const change = { classroomId: id, courseId: id, selection: { ...emptyMaterialSelection, businessClassType: "A+" }, includeDrafts: false };
beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ supabase: { rpc: mocks.rpc }, user: { id } }); });
describe("material action boundaries", () => {
  it("rejects incomplete cohorts and invalid identifiers before authorization or RPC", async () => {
    expect(await previewClassroomMaterialChangeAction({ ...change, selection: { ...change.selection, cohortYear: 2026 } })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await getClassroomMaterialWorkspaceAction("invalid")).toEqual({ ok: false, code: "VALIDATION" });
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a matching preview token and nonblank reason", async () => {
    expect(await applyClassroomMaterialChangeAction({ ...change, expectedToken: "stale", reason: "valid" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await applyClassroomMaterialChangeAction({ ...change, expectedToken: "a".repeat(32), reason: " " })).toEqual({ ok: false, code: "VALIDATION" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses class.manage and preserves scope denial instead of falling back to another RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN_SCOPE" } });
    expect(await previewClassroomMaterialChangeAction(change)).toEqual({ ok: false, code: "FORBIDDEN_SCOPE" });
    expect(mocks.authorize).toHaveBeenCalledWith("class.manage");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("uses course.manage and forwards optimistic revision checks", async () => {
    const input = { title: "New", familyId: id, businessClassType: "A+", materialClassType: "A", fromYear: null, fromSeason: null, toYear: null, toSeason: null, entryGrade: null, enabled: true };
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "MATERIAL_STALE" } });
    expect(await saveCourseMaterialRuleAction(id, 2, input)).toEqual({ ok: false, code: "MATERIAL_STALE" });
    expect(mocks.authorize).toHaveBeenCalledWith("course.manage");
    expect(mocks.rpc).toHaveBeenCalledWith("save_course_material_rule", { p_rule_id: id, p_expected_version: 2, p_input: input });
  });
});
