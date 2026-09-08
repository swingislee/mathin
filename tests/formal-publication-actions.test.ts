import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadFormalPublicationStateAction } from "@/features/courseware-studio/formal-publication-actions";
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), detail: vi.fn(), perms: vi.fn() }));
vi.mock("@/features/school/actions/guards", () => ({ authorizedClient: mocks.authorized }));
vi.mock("@/lib/auth", () => ({ getMyPerms: mocks.perms }));
vi.mock("@/features/school/curriculum/lecture-workspace-detail", () => ({ getLectureWorkspaceDetail: mocks.detail }));
const lectureId = "77777777-7777-4777-8777-777777777777";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authorized.mockResolvedValue({ user: { id: "creator" } });
  mocks.perms.mockResolvedValue(new Set(["courseware.page.edit"]));
  mocks.detail.mockResolvedValue({ tracks: [{ track: "native-16x9", stage: "editing", activeReviewCycle: null },
    { track: "adapted-4x3", stage: "in_review", activeReviewCycle: { creatorId: "creator" } }],
    policy: { allowCreatorAsReviewer: false }, history: [], assignments: ["not returned"] });
});
describe("editor publication state", () => {
  it("rejects invalid IDs before reading protected data", async () => {
    expect(await loadFormalPublicationStateAction({ lectureId: "invalid" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(mocks.authorized).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it("requires editor authorization and preserves scope rejection", async () => {
    mocks.authorized.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect(await loadFormalPublicationStateAction({ lectureId })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.detail).not.toHaveBeenCalled();
    mocks.detail.mockRejectedValueOnce(new Error("FORBIDDEN_SCOPE"));
    expect(await loadFormalPublicationStateAction({ lectureId })).toEqual({ ok: false, code: "FORBIDDEN_SCOPE" });
  });
  it("reads fresh workflow states with the same per-track capability formula as the review workspace", async () => {
    mocks.perms.mockResolvedValue(new Set(["courseware.page.edit", "courseware.review", "courseware.release.publish"]));
    const result = await loadFormalPublicationStateAction({ lectureId });
    expect(mocks.authorized).toHaveBeenCalledWith("courseware.page.edit");
    expect(mocks.detail).toHaveBeenCalledWith(lectureId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).not.toHaveProperty("assignments");
    expect(result.data.capabilitiesByTrack["native-16x9"].canSubmit).toBe(true);
    expect(result.data.capabilitiesByTrack["adapted-4x3"]).toMatchObject({ canApprove: false, canWithdraw: true, canPublishNow: false });
    mocks.detail.mockResolvedValue({ tracks: [{ track: "adapted-4x3", stage: "ready_to_publish" }], policy: { allowCreatorAsReviewer: false }, history: [] });
    const fresh = await loadFormalPublicationStateAction({ lectureId });
    expect(fresh.ok && fresh.data.capabilitiesByTrack["adapted-4x3"].canPublishNow).toBe(true);
  });
});
