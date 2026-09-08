import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteFormalCoursewarePageAction, reorderFormalCoursewarePagesAction } from "@/features/courseware-studio/formal-page-management-actions";
const rpc = vi.hoisted(() => vi.fn());
const authorized = vi.hoisted(() => vi.fn());
vi.mock("@/features/school/actions/guards", () => ({ authorizedClient: authorized }));
const lectureId = "77777777-7777-4777-8777-777777777777";
const pageId = "88888888-8888-4888-8888-888888888888";
beforeEach(() => { rpc.mockReset(); authorized.mockReset(); authorized.mockResolvedValue({ supabase: { rpc } }); });
describe("formal page management actions", () => {
  it("reuses authorized reorder and soft-delete RPCs", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await reorderFormalCoursewarePagesAction({ lectureId, pageIds: [pageId, lectureId] })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("reorder_cw_pages", { p_lecture_id: lectureId, p_page_ids: [pageId, lectureId] });
    expect(await deleteFormalCoursewarePageAction({ pageDocId: pageId })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("soft_delete_cw_page", { p_page_doc_id: pageId });
    expect(authorized).toHaveBeenCalledWith("courseware.page.edit");
  });
  it("rejects malformed, empty and duplicate page orders before authorization", async () => {
    for (const pageIds of [[], [pageId, pageId], ["invalid"]]) {
      expect(await reorderFormalCoursewarePagesAction({ lectureId, pageIds })).toEqual({ ok: false, code: "VALIDATION" });
    }
    expect(await deleteFormalCoursewarePageAction({ pageDocId: "invalid" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(authorized).not.toHaveBeenCalled();
  });
  it("reports last-page, stale-list and permission failures without claiming success", async () => {
    rpc.mockResolvedValue({ error: { message: "LAST_PAGE_FORBIDDEN" } });
    expect(await deleteFormalCoursewarePageAction({ pageDocId: pageId })).toEqual({ ok: false, code: "LAST_PAGE_FORBIDDEN" });
    rpc.mockResolvedValue({ error: { message: "PAGE_ORDER_MISMATCH" } });
    expect(await reorderFormalCoursewarePagesAction({ lectureId, pageIds: [pageId] })).toEqual({ ok: false, code: "PAGE_ORDER_MISMATCH" });
    authorized.mockRejectedValue(new Error("FORBIDDEN"));
    expect(await deleteFormalCoursewarePageAction({ pageDocId: pageId })).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});
