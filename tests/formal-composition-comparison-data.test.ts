import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { FORMAL_MANUAL_PAGE_SOURCE } from "@/features/courseware-studio/formal-manual-page-contract";
import { loadUnifiedCoursewareWorkspaceData } from "@/features/courseware-studio/unified-workspace-data";

const mocks = vi.hoisted(() => ({ studio: vi.fn(), preview: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth", () => ({ requirePerm: vi.fn() }));
vi.mock("@/features/school/curriculum/lecture-workspace-detail", () => ({ isUuid: () => true, getLectureWorkspaceDetail: async () => ({ variant: { id: "course" } }) }));
vi.mock("@/features/courseware-studio/formal-cube-page-data", () => ({ loadFormalWorkspacePages: async () => [{ pageDocId: "page", composition: true, sourceCoursewareId: FORMAL_MANUAL_PAGE_SOURCE }] }));
vi.mock("@/features/courseware-studio/data", () => ({
  loadCoursewareStudioPage: mocks.studio, loadLecturePreview: mocks.preview,
  parseCoursewareTrack: (track: string) => track === "adapted-4x3" ? track : "native-16x9",
}));

const native = createEmptyCoursewareCompositionPage();
const adapted = { ...createEmptyCoursewareCompositionPage(), canvas: { ...native.canvas, backgroundColor: "#abcdef" } };
beforeEach(() => {
  mocks.preview.mockReset().mockResolvedValue(null);
  mocks.studio.mockReset().mockImplementation(async (_lecture, _page, track) => ({
    page: { title: "Blank composition" }, bindingUrls: { asset: `${track}-url` },
    activeRevision: { doc: track === "adapted-4x3" ? adapted : native, revisionNo: track === "adapted-4x3" ? 5 : 2 },
  }));
});
describe("composition comparison uses saved drafts without requiring a release", () => {
  it("loads both track documents and their own asset bindings for comparison", async () => {
    const result = await loadUnifiedCoursewareWorkspaceData("zh", "lecture", { pageId: "page", canvas: "compare" });
    expect(result.formalCubeEditor?.comparison).toEqual({
      "native-16x9": { doc: native, bindingUrls: { asset: "native-16x9-url" } },
      "adapted-4x3": { doc: adapted, bindingUrls: { asset: "adapted-4x3-url" } },
    });
    expect(result.nativePreview).toBeNull(); expect(result.adaptedPreview).toBeNull();
  });
  it.each(["native-16x9", "adapted-4x3"])("keeps %s editing on its own track without sending comparison copies", async (track) => {
    const result = await loadUnifiedCoursewareWorkspaceData("en", "lecture", { pageId: "page", canvas: track, track });
    expect(result.formalCubeEditor?.track).toBe(track);
    expect(result.formalCubeEditor?.doc).toEqual(track === "adapted-4x3" ? adapted : native);
    expect(result.formalCubeEditor?.comparison).toBeUndefined();
  });
});
