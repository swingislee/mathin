import type { CoursewareTrackState } from "./types";

/** doc19 §9.4 十态文案键，供服务端 StatusStrip 与客户端 DecisionRail 共用同一套判定。 */
export function lectureStageLabelKey(trackState: CoursewareTrackState): { key: string; params?: Record<string, number> } {
  if (trackState.stage === "idle") {
    if (!trackState.currentReleaseNo) return { key: "stageNotStarted" };
    return { key: trackState.hasUnpublishedChanges ? "stagePublishedWithDraft" : "stagePublished" };
  }
  if (trackState.stage === "editing") return { key: "stageEditing" };
  if (trackState.stage === "in_review") return { key: "stagePendingRound", params: { round: trackState.currentReviewRound ?? 1 } };
  if (trackState.stage === "changes_requested") return { key: "stageRejectedRound", params: { round: trackState.currentReviewRound ?? 1 } };
  return { key: "stageReadyToPublish" };
}
