import { beforeEach, describe, expect, it, vi } from "vitest";
import { automaticCourseware43Doc } from "@/features/courseware-studio/automatic-adaptation-contract";
import { prepareLectureAdaptedDraftsAction } from "@/features/courseware-studio/automatic-adaptation-actions";
import { courseware43SessionFromPageDoc } from "@/features/courseware-doc/courseware-4x3-strategy";
import { pageDocSchema } from "@/features/courseware-doc/schema";
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), detail: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/features/school/actions/guards", () => ({ authorizedClient: mocks.authorized }));
vi.mock("@/features/school/curriculum/lecture-workspace-detail", () => ({ getLectureWorkspaceDetail: mocks.detail }));
const lectureId = "77777777-7777-4777-8777-777777777777";
const doc = pageDocSchema.parse({ docVersion: "page-doc-v1", sourceCoursewareId: "cw", sourcePageId: "page", sourcePageDatabaseId: 1, sourceSnapshotId: 1,
  sourceContentHash: "a".repeat(64), canvas: { width: 1280, height: 720, backgroundColor: null, backgroundBindingKey: null }, nodes: [], interactions: [] });
const page = (id: string, adapted = false) => ({ id, adapt_class: "A", cw_page_track_heads: [
  { track: "native-16x9", draft_revision_id: `native-${id}`, current_revision_id: null },
  ...(adapted ? [{ track: "adapted-4x3", draft_revision_id: `edited-${id}`, current_revision_id: null }] : []),
] });
function query(data: unknown) {
  const builder = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), single: vi.fn() };
  builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder); builder.is.mockReturnValue(builder);
  builder.order.mockResolvedValue({ data, error: null }); builder.single.mockResolvedValue({ data, error: null });
  return builder;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.authorized.mockResolvedValue({ supabase: { from: mocks.from, rpc: mocks.rpc } });
  mocks.detail.mockResolvedValue({}); mocks.rpc.mockResolvedValue({ data: true, error: null });
});
describe("automatic lecture rough drafts", () => {
  it("uses the existing A–F matching rules without modifying source documents", () => {
    const before = structuredClone(doc);
    for (const [classification, strategy] of Object.entries({ A: "fit-height-left", B: "fit-height-left", C: "fit-width-center", D: "fit-width-top", E: "fit-width-center", F: "background-height-content-width" })) {
      const adapted = pageDocSchema.parse(automaticCourseware43Doc(doc, classification));
      expect(courseware43SessionFromPageDoc(adapted)?.strategy).toBe(strategy);
      expect(adapted.canvas.width / adapted.canvas.height).toBe(4 / 3);
    }
    expect(doc).toEqual(before);
    expect(() => automaticCourseware43Doc({ docVersion: "unknown" }, null)).toThrow("UNSUPPORTED_AUTO_ADAPTATION");
  });
  it("prepares a bounded batch across the lecture and skips existing hand-edited pages", async () => {
    mocks.from.mockImplementation((table) => query(table === "cw_page_docs" ? [page("saved", true), ...Array.from({ length: 10 }, (_, index) => page(String(index)))] : { doc }));
    expect(await prepareLectureAdaptedDraftsAction({ lectureId })).toEqual({ ok: true, data: { created: 8, remaining: 2 } });
    expect(mocks.rpc).toHaveBeenCalledTimes(8);
    expect(mocks.rpc.mock.calls.every(([name, args]) => name === "create_missing_cw_adapted_draft" && args.p_page_doc_id !== "saved")).toBe(true);
    expect(mocks.rpc.mock.calls[0][1].p_source_revision_id).toBe("native-0");
    expect(mocks.detail).toHaveBeenCalledWith(lectureId);
  });
  it("is a read-only no-op when all pages already have drafts or releases", async () => {
    mocks.from.mockReturnValue(query([page("saved", true)]));
    expect(await prepareLectureAdaptedDraftsAction({ lectureId })).toEqual({ ok: true, data: { created: 0, remaining: 0 } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs, unauthorized scope and source concurrency conflicts", async () => {
    expect(await prepareLectureAdaptedDraftsAction({ lectureId: "invalid" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(mocks.authorized).not.toHaveBeenCalled();
    mocks.detail.mockRejectedValueOnce(new Error("FORBIDDEN_SCOPE"));
    expect(await prepareLectureAdaptedDraftsAction({ lectureId })).toEqual({ ok: false, code: "FORBIDDEN_SCOPE" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.from.mockImplementation((table) => query(table === "cw_page_docs" ? [page("1")] : { doc }));
    mocks.rpc.mockResolvedValue({ data: false, error: { message: "VERSION_CONFLICT" } });
    expect(await prepareLectureAdaptedDraftsAction({ lectureId })).toEqual({ ok: false, code: "VERSION_CONFLICT" });
  });
});
