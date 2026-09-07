import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankCoursewarePageAction } from "@/features/courseware-studio/formal-manual-page-actions";

const rpc = vi.hoisted(() => vi.fn());
const authorized = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/school/actions/guards", () => ({ authorizedClient: authorized }));
vi.mock("@/features/courseware-studio/data", () => ({ COURSEWARE_TRACKS: ["native-16x9", "adapted-4x3"] }));
beforeEach(() => {
  rpc.mockReset(); authorized.mockReset(); authorized.mockResolvedValue({ supabase: { rpc } });
});
const input = { lectureId: "77777777-7777-4777-8777-777777777777", afterPageDocId: null, title: "Untitled" };

describe("restored blank page creation action", () => {
  it("calls the original generic RPC with page context only, without a component payload", async () => {
    rpc.mockResolvedValue({ data: "88888888-8888-4888-8888-888888888888", error: null });
    expect(await createBlankCoursewarePageAction(input)).toMatchObject({ ok: true });
    expect(authorized).toHaveBeenCalledWith("courseware.page.edit");
    expect(rpc).toHaveBeenCalledWith("create_blank_cw_page", { p_lecture_id: input.lectureId, p_after_page_doc_id: undefined, p_title: "Untitled" });
  });
  it("rejects prefilled component input and reports create failures without claiming success", async () => {
    expect(await createBlankCoursewarePageAction({ ...input, tool: {} } as typeof input)).toEqual({ ok: false, code: "VALIDATION" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { message: "RELATION_REQUIRED" } });
    expect(await createBlankCoursewarePageAction(input)).toEqual({ ok: false, code: "RELATION_REQUIRED" });
  });
});
