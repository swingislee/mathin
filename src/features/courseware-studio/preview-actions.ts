"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, uuid } from "@/features/school/actions/schemas";
import {
  COURSEWARE_TRACKS,
  loadCoursewareStudioRenderPage,
  type CoursewareStudioRenderPagePayload,
} from "./data";

const studioRenderPageSchema = z.object({
  pageDocId: uuid,
  revisionId: uuid,
  track: z.enum(COURSEWARE_TRACKS),
}).strict();

export async function loadCoursewareStudioRenderPageAction(
  input: z.input<typeof studioRenderPageSchema>,
): Promise<ActionResult<CoursewareStudioRenderPagePayload>> {
  try {
    const value = parse(studioRenderPageSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    return {
      ok: true,
      data: await loadCoursewareStudioRenderPage(
        value.pageDocId,
        value.revisionId,
        value.track,
        supabase,
      ),
    };
  } catch (error) {
    return actionError(error, [
      "PAGE_REVISION_MISSING",
      "H5_MANIFEST_MISSING",
      "SIGNED_URL_MISSING",
      ...COMMON_CODES,
    ]);
  }
}
