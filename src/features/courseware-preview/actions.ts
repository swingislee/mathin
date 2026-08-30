"use server";

import { z } from "zod";
import {
  COURSEWARE_TRACKS,
  loadLecturePreviewPage,
  type CoursewarePreviewPagePayload,
} from "@/features/courseware-studio/data";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, uuid } from "@/features/school/actions/schemas";

const previewPageSchema = z.object({
  releaseId: uuid,
  track: z.enum(COURSEWARE_TRACKS),
  pageDocId: uuid,
});

export async function loadCoursewarePreviewPageAction(
  input: z.input<typeof previewPageSchema>,
): Promise<ActionResult<CoursewarePreviewPagePayload>> {
  try {
    const value = parse(previewPageSchema, input);
    const { supabase } = await authorizedClient("course.view");
    return {
      ok: true,
      data: await loadLecturePreviewPage(value.releaseId, value.track, value.pageDocId, supabase),
    };
  } catch (error) {
    return actionError(error, [
      "RELEASE_NOT_FOUND",
      "RELEASE_TRACK_MISMATCH",
      "PREVIEW_PAGE_NOT_FOUND",
      "RELEASE_SNAPSHOT_INCOMPLETE",
      "RELEASE_ASSET_REVISION_MISSING",
      "SIGNED_URL_MISSING",
      ...COMMON_CODES,
    ]);
  }
}
