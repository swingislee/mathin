"use server";

import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getMyPerms } from "@/lib/auth";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, uuid } from "@/features/school/actions/schemas";
import { getLectureWorkspaceDetail } from "@/features/school/curriculum/lecture-workspace-detail";
import { lectureReviewCapabilitiesByTrack } from "@/features/school/curriculum/lecture-review-capabilities";
import type { LectureWorkspaceDetail } from "@/features/school/curriculum/types";

const schema = z.object({ lectureId: uuid }).strict();
export type FormalPublicationState = Pick<LectureWorkspaceDetail, "tracks" | "policy" | "history"> & {
  capabilitiesByTrack: ReturnType<typeof lectureReviewCapabilitiesByTrack>;
};

/** 打开发布面板时读取最新草稿工作流；不提交审核或推进 release。 */
export async function loadFormalPublicationStateAction(input: z.input<typeof schema>): Promise<ActionResult<FormalPublicationState>> {
  try {
    const { lectureId } = parse(schema, input);
    const { user } = await authorizedClient("courseware.page.edit");
    const [detail, perms] = await Promise.all([getLectureWorkspaceDetail(lectureId), getMyPerms(user.id)]);
    return { ok: true, data: { tracks: detail.tracks, policy: detail.policy, history: detail.history,
      capabilitiesByTrack: lectureReviewCapabilitiesByTrack(detail, perms, user.id) } };
  } catch (error) { return actionError<FormalPublicationState>(error, ["LECTURE_NOT_FOUND", "FORBIDDEN_SCOPE", ...COMMON_CODES]); }
}
