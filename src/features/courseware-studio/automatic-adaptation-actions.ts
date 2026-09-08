"use server";

import { z } from "zod";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, parse, uuid } from "@/features/school/actions/schemas";
import { getLectureWorkspaceDetail } from "@/features/school/curriculum/lecture-workspace-detail";
import { actionError, type ActionResult } from "@/lib/action-result";
import { automaticCourseware43Doc } from "./automatic-adaptation-contract";

const schema = z.object({ lectureId: uuid }).strict();
export async function prepareLectureAdaptedDraftsAction(input: z.input<typeof schema>): Promise<ActionResult<{ created: number; remaining: number }>> {
  try {
    const { lectureId } = parse(schema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    await getLectureWorkspaceDetail(lectureId);
    const { data: pages, error } = await supabase.from("cw_page_docs")
      .select("id,adapt_class,cw_page_track_heads(track,draft_revision_id,current_revision_id)")
      .eq("lecture_id", lectureId).is("deleted_at", null).order("page_no");
    if (error) throw new Error(error.message);
    const missing = (pages ?? []).filter((page) => !page.cw_page_track_heads.some((head) => head.track === "adapted-4x3" && (head.draft_revision_id || head.current_revision_id)));
    const batch = missing.slice(0, 8);
    let created = 0;
    for (const page of batch) {
      const native = page.cw_page_track_heads.find((head) => head.track === "native-16x9");
      const revisionId = native?.draft_revision_id ?? native?.current_revision_id;
      if (!revisionId) throw new Error("PAGE_TRACK_NOT_READY");
      const { data: revision, error: revisionError } = await supabase.from("cw_page_revisions").select("doc").eq("id", revisionId).single();
      if (revisionError || !revision) throw new Error(revisionError?.message ?? "PAGE_TRACK_NOT_READY");
      const doc = automaticCourseware43Doc(revision.doc, page.adapt_class);
      const { data, error: saveError } = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: boolean; error: { message: string } | null }>)
        ("create_missing_cw_adapted_draft", { p_page_doc_id: page.id, p_source_revision_id: revisionId, p_doc: doc });
      if (saveError) throw new Error(saveError.message);
      if (data) created += 1;
    }
    return { ok: true, data: { created, remaining: missing.length - batch.length } };
  } catch (error) { return actionError(error, ["UNSUPPORTED_AUTO_ADAPTATION", "VERSION_CONFLICT", "PAGE_TRACK_NOT_READY", "FORBIDDEN_SCOPE", "LECTURE_NOT_FOUND", ...COMMON_CODES]); }
}
