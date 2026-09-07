"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, intInRange, parse, requiredText, text, uuid } from "@/features/school/actions/schemas";
import { cubeCoursewareV2ToolSchema } from "@/features/tools/courseware/cube-structures-content";
import { createFormalCubePage, formalCubePageSchema } from "./formal-cube-page-contract";
import { COURSEWARE_TRACKS } from "./data";

const createSchema = z.object({ lectureId: uuid, pageDocId: uuid, title: requiredText(100), tool: cubeCoursewareV2ToolSchema }).strict();
const saveSchema = z.object({ pageDocId: uuid, track: z.enum(COURSEWARE_TRACKS),
  doc: formalCubePageSchema, baseRevisionNo: intInRange(1, 100_000), note: text(1000) }).strict();
const codes = ["INVALID_FORMAL_CUBE_PAGE", "FORMAL_CUBE_PAGE_REQUIRED", "PAGE_ID_CONFLICT", "PAGE_LIMIT_EXCEEDED",
  "VERSION_CONFLICT", "PAGE_TRACK_NOT_FOUND", "MISSING_PERMISSION", "INACTIVE_ACTOR", "RELATION_REQUIRED",
  "RESPONSIBILITY_REQUIRED", "LECTURE_NOT_FOUND", "COURSE_TRASHED", "LECTURE_ARCHIVED", "FAMILY_DISABLED", "COURSE_DISABLED", ...COMMON_CODES];
type Client = Awaited<ReturnType<typeof authorizedClient>>["supabase"];
function rpc<T>(client: Client, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as (fn: string, params: Record<string, unknown>) => Promise<{ data: T; error: { message: string } | null }>)(name, args);
}

export async function createFormalCubePageAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ pageDocId: string }>> {
  try {
    const value = parse(createSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    const { data, error } = await rpc<string>(supabase, "create_cw_formal_cube_page", {
      p_lecture_id: value.lectureId, p_page_doc_id: value.pageDocId, p_title: value.title, p_doc: createFormalCubePage(value.tool),
    });
    if (error || !data) throw new Error(error?.message ?? "SAVE_FAILED");
    revalidatePath("/[locale]/dashboard/courseware/lectures/[lectureId]", "page");
    return { ok: true, data: { pageDocId: data } };
  } catch (error) { return actionError(error, [...codes, "SAVE_FAILED"]); }
}

export async function saveFormalCubePageAction(input: z.input<typeof saveSchema>): Promise<ActionResult<{ revisionNo: number }>> {
  try {
    const value = parse(saveSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    const { data, error } = await rpc<Array<{ revision_no: number }>>(supabase, "save_cw_formal_cube_page", {
      p_page_doc_id: value.pageDocId, p_track: value.track, p_doc: value.doc,
      p_base_revision_no: value.baseRevisionNo, p_note: value.note,
    });
    if (error || !data?.[0]) throw new Error(error?.message ?? "SAVE_FAILED");
    return { ok: true, data: { revisionNo: data[0].revision_no } };
  } catch (error) { return actionError(error, [...codes, "SAVE_FAILED"]); }
}
