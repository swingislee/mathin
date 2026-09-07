import "server-only";

import { createClient } from "@/lib/supabase/server";
import { FORMAL_CUBE_PAGE_SOURCE, type FormalCubePageSummary } from "./formal-cube-page-contract";
import { FORMAL_MANUAL_PAGE_SOURCE } from "./formal-manual-page-contract";

/** 工作区读取尚未发布的追加页；发布预览继续只读取 immutable release。 */
export async function loadFormalCubePages(lectureId: string): Promise<FormalCubePageSummary[]> {
  const client = await createClient();
  const { data, error } = await client.from("cw_page_docs").select("id,title,page_no,source_courseware_id")
    .eq("lecture_id", lectureId).in("source_courseware_id", [FORMAL_CUBE_PAGE_SOURCE, FORMAL_MANUAL_PAGE_SOURCE])
    .eq("doc_version", "courseware-composition-v1").is("deleted_at", null).order("page_no");
  if (error) throw new Error(error.message);
  return (data ?? []).map((page) => ({ pageDocId: page.id, title: page.title, pageNo: page.page_no, sourceCoursewareId: page.source_courseware_id ?? undefined }));
}
