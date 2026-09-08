import "server-only";

import { createClient } from "@/lib/supabase/server";
import { FORMAL_CUBE_PAGE_SOURCE, type FormalWorkspacePageSummary } from "./formal-cube-page-contract";
import { FORMAL_MANUAL_PAGE_SOURCE } from "./formal-manual-page-contract";

/** 编辑目录读取当前有效页面及顺序；产品预览仍只读取 immutable release。 */
export async function loadFormalWorkspacePages(lectureId: string): Promise<FormalWorkspacePageSummary[]> {
  const client = await createClient();
  const { data, error } = await client.from("cw_page_docs").select("id,title,page_no,source_courseware_id,doc_version,draft_revision_id,current_revision_id,cw_page_track_heads(track,draft_revision_id,current_revision_id)")
    .eq("lecture_id", lectureId).is("deleted_at", null).order("page_no");
  if (error) throw new Error(error.message);
  return (data ?? []).map((page) => ({ pageDocId: page.id, title: page.title, pageNo: page.page_no, sourceCoursewareId: page.source_courseware_id ?? undefined,
    composition: page.doc_version === "courseware-composition-v1" && [FORMAL_CUBE_PAGE_SOURCE, FORMAL_MANUAL_PAGE_SOURCE].some((source) => source === page.source_courseware_id),
    nativeAvailable: Boolean(page.draft_revision_id ?? page.current_revision_id) || page.cw_page_track_heads.some((head) => head.track === "native-16x9" && (head.draft_revision_id ?? head.current_revision_id)),
    adaptedAvailable: page.cw_page_track_heads.some((head) => head.track === "adapted-4x3" && (head.draft_revision_id ?? head.current_revision_id)),
  }));
}
