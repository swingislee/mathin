import type { CoursewareTrack } from "@/features/courseware-studio/data";
import type { PermissionKey } from "@/features/school/permissions";
import { resolveLectureReviewCapabilities } from "@/features/school/teaching-operations/capabilities";
import type { LectureReviewCapabilities } from "@/features/school/teaching-operations/types";
import type { LectureWorkspaceDetail } from "./types";

export function lectureReviewCapabilitiesByTrack(detail: Pick<LectureWorkspaceDetail, "tracks" | "policy">, perms: ReadonlySet<PermissionKey>, userId: string) {
  return Object.fromEntries(detail.tracks.map((state) => [state.track, resolveLectureReviewCapabilities({
    canEditPage: perms.has("courseware.page.edit"),
    canReview: perms.has("courseware.review"),
    canPublish: perms.has("courseware.release.publish"),
    canEmergencyPublish: perms.has("courseware.emergency_publish"),
    stage: state.stage,
    activeCycleCreatorId: state.activeReviewCycle?.creatorId ?? null,
    allowCreatorAsReviewer: detail.policy.allowCreatorAsReviewer,
    currentUserId: userId,
  })])) as Record<CoursewareTrack, LectureReviewCapabilities>;
}
