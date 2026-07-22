import "server-only";

import { notFound } from "next/navigation";
import { loadLecturePreview, parseCoursewareTrack, type CoursewareTrack } from "@/features/courseware-studio/data";
import { listStaffOptions } from "@/features/school/classes";
import { resolveLectureReviewCapabilities } from "@/features/school/teaching-operations/capabilities";
import type { LectureReviewCapabilities } from "@/features/school/teaching-operations/types";
import { getMyPerms, requirePerm } from "@/lib/auth";
import { getLectureWorkspaceDetail, isUuid } from "./lecture-workspace-detail";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function loadLectureWorkspacePageData(
  locale: string,
  lectureId: string,
  rawSearchParams: Record<string, string | string[] | undefined>,
) {
  if (!isUuid(lectureId)) notFound();
  const user = await requirePerm(locale, "course.view");

  const [detail, perms, staffOptions] = await Promise.all([
    getLectureWorkspaceDetail(lectureId).catch((error) => {
      if (error instanceof Error && (error.message.includes("LECTURE_NOT_FOUND") || error.message.includes("FORBIDDEN_SCOPE"))) return null;
      throw error;
    }),
    getMyPerms(user.id),
    listStaffOptions(),
  ]);
  if (!detail) notFound();

  const track = parseCoursewareTrack(first(rawSearchParams.track));
  const canEditPage = perms.has("courseware.page.edit");
  const canReview = perms.has("courseware.review");
  const canPublish = perms.has("courseware.release.publish");
  const canEmergencyPublish = perms.has("courseware.emergency_publish");
  const canAssign = perms.has("course.assignment.manage");

  const capabilitiesByTrack = Object.fromEntries(detail.tracks.map((trackState) => [
    trackState.track,
    resolveLectureReviewCapabilities({
      canEditPage,
      canReview,
      canPublish,
      canEmergencyPublish,
      stage: trackState.stage,
      activeCycleCreatorId: trackState.activeReviewCycle?.creatorId ?? null,
      allowCreatorAsReviewer: detail.policy.allowCreatorAsReviewer,
      currentUserId: user.id,
    }),
  ])) as Record<CoursewareTrack, LectureReviewCapabilities>;

  const requestedPageRaw = Number(first(rawSearchParams.page));
  const requestedPage = Number.isInteger(requestedPageRaw) && requestedPageRaw > 0 ? requestedPageRaw : undefined;
  const preview = await loadLecturePreview(lectureId, track, requestedPage);
  const validPreview = preview && preview.lecture.id === detail.lecture.id ? preview : null;

  return {
    detail,
    track,
    staffOptions,
    capabilitiesByTrack,
    preview: validPreview,
    canOpenCoursewareWorkbench: canEditPage,
    canAssign,
  };
}
