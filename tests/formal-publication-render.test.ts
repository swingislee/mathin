// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { FormalCoursewarePublicationDialog } from "@/features/courseware-studio/FormalCoursewarePublicationDialog";
import { DecisionRailContent } from "@/features/school/curriculum/DecisionRailContent";
import type { FormalPublicationState } from "@/features/courseware-studio/formal-publication-actions";
const mocks = vi.hoisted(() => ({ load: vi.fn(), submit: vi.fn(), approve: vi.fn(), publish: vi.fn(), withdraw: vi.fn(), reject: vi.fn(), emergency: vi.fn(), refresh: vi.fn(), editing: false, error: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => (props: ComponentProps<typeof DecisionRailContent>) => createElement(DecisionRailContent, props) }));
vi.mock("@/features/courseware-doc/CoursewareEditorWorkbench", () => ({ useCoursewarePageActionsDisabled: () => mocks.editing }));
vi.mock("@/features/courseware-studio/formal-publication-actions", () => ({ loadFormalPublicationStateAction: mocks.load }));
vi.mock("@/features/courseware-studio/actions", () => ({ submitCoursewareReviewAction: mocks.submit, approveCoursewareReviewAction: mocks.approve, publishCoursewareReviewCycleAction: mocks.publish,
  withdrawCoursewareReviewAction: mocks.withdraw, rejectCoursewareReviewAction: mocks.reject, emergencyPublishCoursewareReviewAction: mocks.emergency }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.error } }));
let root: Root, host: HTMLDivElement;
function state(stage: "editing" | "in_review" | "ready_to_publish" | "idle", allow = true): FormalPublicationState {
  return { policy: { requiredReviewRounds: 1, allowCreatorAsReviewer: true, emergencyPublishEnabled: false }, history: [],
    tracks: [{ track: "adapted-4x3", stage, currentReviewRound: stage === "in_review" ? 1 : null, requiredReviewRounds: 1,
      internalDueAt: null, currentReleaseNo: stage === "idle" ? 1 : null, hasUnpublishedChanges: stage !== "idle",
      activeReviewCycle: stage === "in_review" ? { id: "cycle", creatorId: "creator", creatorName: "Editor", submittedAt: "2026-09-08", submissionNote: "" } : null }],
    capabilitiesByTrack: { "adapted-4x3": { canSubmit: allow && stage === "editing", canApprove: allow && stage === "in_review", canPublishNow: allow && stage === "ready_to_publish",
      canWithdraw: false, canReject: false, canEmergencyPublishNow: false }, "native-16x9": { canSubmit: false, canApprove: false, canPublishNow: false, canWithdraw: false, canReject: false, canEmergencyPublishNow: false } } };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.editing = false; mocks.load.mockResolvedValue({ ok: true, data: state("editing") });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount() {
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, children: createElement(FormalCoursewarePublicationDialog, { lectureId: "lecture", track: "adapted-4x3" }) })));
}
function button(text: string) { return [...document.querySelectorAll("button")].find((item) => item.textContent === text) as HTMLButtonElement | undefined; }
async function click(text: string) { expect(button(text)).toBeDefined(); await act(async () => button(text)!.click()); }
const labels = en.coursewareWorkspace.publication;
describe("editor review and publication entry", () => {
  it("loads only on opening and respects unsaved-editor protection", async () => {
    mocks.editing = true; await mount();
    expect(button(labels.title)?.disabled).toBe(true);
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.editing = false; await mount(); await click(labels.title);
    expect(mocks.load).toHaveBeenCalledWith({ lectureId: "lecture" });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(en.coursewareWorkspace.canvasAdapted);
    expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("keeps submit, approve and publish explicit and reloads each resulting state", async () => {
    await mount(); await click(labels.title);
    mocks.submit.mockResolvedValue({ ok: true, data: "cycle" }); mocks.load.mockResolvedValue({ ok: true, data: state("in_review") });
    await click(en.school.lecture.submitForReview);
    expect(mocks.submit).toHaveBeenCalledWith("lecture", "adapted-4x3", ""); expect(mocks.publish).not.toHaveBeenCalled();
    mocks.approve.mockResolvedValue({ ok: true, data: "cycle" }); mocks.load.mockResolvedValue({ ok: true, data: state("ready_to_publish") });
    await click(en.school.lecture.approve);
    expect(mocks.approve).toHaveBeenCalledWith("cycle", ""); expect(mocks.publish).not.toHaveBeenCalled();
    mocks.publish.mockResolvedValue({ ok: true, data: { releaseId: "release" } }); mocks.load.mockResolvedValue({ ok: true, data: state("idle") });
    await click(en.school.lecture.publishRelease);
    expect(mocks.publish).toHaveBeenCalledWith("lecture", "adapted-4x3", "");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Current published version: v1");
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
  });
  it("does not offer write actions without capabilities", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: state("ready_to_publish", false) });
    await mount(); await click(labels.title);
    expect(button(en.school.lecture.publishRelease)).toBeUndefined(); expect(button(en.school.lecture.emergencyPublish)).toBeUndefined();
  });
  it("reports incomplete tracks and retries read failures without publishing", async () => {
    mocks.load.mockResolvedValueOnce({ ok: false, code: "FORBIDDEN" });
    await mount(); await click(labels.title);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(labels.loadFailed);
    await click(labels.retry);
    mocks.submit.mockResolvedValue({ ok: false, code: "PAGE_TRACK_NOT_READY" });
    await click(en.school.lecture.submitForReview);
    expect(mocks.error).toHaveBeenCalledWith(labels.trackNotReady); expect(mocks.publish).not.toHaveBeenCalled();
    expect(button(en.school.lecture.submitForReview)).toBeDefined();
  });
});
