"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, text, uuid } from "@/features/school/actions/schemas";
import { actionError, type ActionResult } from "@/lib/action-result";

const publishSchema = z.object({
  lectureIds: z.array(uuid).min(1).max(30),
  note: text(1000),
});

type UntypedRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

/** 人工选择单讲或当前页多讲后发布；数据库在一个事务内完成所有 release，任一讲失败则整批回滚。 */
export async function publishAdaptReleasesAction(
  input: z.input<typeof publishSchema>,
): Promise<ActionResult<{ publishedCount: number }>> {
  try {
    const value = parse(publishSchema, input);
    if (new Set(value.lectureIds).size !== value.lectureIds.length) throw new Error("VALIDATION");
    const { supabase } = await authorizedClient("courseware.release.publish");
    const { data, error } = await (supabase.rpc as unknown as UntypedRpc).bind(supabase)("publish_cw_adapt_releases", {
      p_lecture_ids: value.lectureIds,
      p_note: value.note,
    });
    if (error) throw new Error(error.message);
    const rows = z.array(z.object({ lecture_id: uuid, release_id: uuid })).parse(data ?? []);
    if (rows.length !== value.lectureIds.length) throw new Error("RELEASE_COUNT_MISMATCH");
    revalidatePath("/dashboard/adapt-review");
    return { ok: true, data: { publishedCount: rows.length } };
  } catch (error) {
    return actionError(error, [
      "INVALID_LECTURE_SELECTION",
      "ADAPT_RELEASE_NOT_READY",
      "PAGE_TRACK_NOT_READY",
      "UNRESOLVED_ASSET_BINDING",
      "ADAPT_BACKGROUND_REVIEW_REQUIRED",
      "RELEASE_SNAPSHOT_TOO_LARGE_OR_INVALID",
      "RELEASE_COUNT_MISMATCH",
      ...COMMON_CODES,
    ]);
  }
}
