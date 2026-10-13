"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/database.types";
import { authorizedClient } from "@/features/school/actions/guards";
import { COMMON_CODES, intInRange, parse, requiredText, text, uuid } from "@/features/school/actions/schemas";
import { COURSEWARE_TRACKS } from "./data";
import { formalManualPageSchema } from "./formal-manual-page-contract";
import { gamePageDocSchema, type GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import { createDefaultGameCoursewarePayload } from "@/features/games/courseware/contracts";
import { gameCoursewareContractsForSurface } from "@/features/games/courseware/registry";
import { validateGameCoursewareContent } from "@/features/games/courseware/server";

const createSchema = z.object({ lectureId: uuid, afterPageDocId: uuid.nullable(), title: requiredText(500) }).strict();
const saveSchema = z.object({ pageDocId: uuid, track: z.enum(COURSEWARE_TRACKS), doc: formalManualPageSchema,
  baseRevisionNo: intInRange(1, 100_000), note: text(1000) }).strict();
const codes = ["AFTER_PAGE_NOT_FOUND", "INVALID_MANUAL_COMPOSITION_PAGE", "MANUAL_COMPOSITION_PAGE_REQUIRED", "COURSEWARE_DOC_BINDING_MISSING",
  "PAGE_LIMIT_EXCEEDED", "VERSION_CONFLICT", "PAGE_TRACK_NOT_FOUND", "MISSING_PERMISSION", "INACTIVE_ACTOR",
  "RELATION_REQUIRED", "RESPONSIBILITY_REQUIRED", "LECTURE_NOT_FOUND", "COURSE_TRASHED", "LECTURE_ARCHIVED", "FAMILY_DISABLED", "COURSE_DISABLED", "SAVE_FAILED", ...COMMON_CODES];

/** 接回旧 Studio 的通用空白页接口；组件只在创建后由编辑器插入。 */
export async function createBlankCoursewarePageAction(input: z.input<typeof createSchema>): Promise<ActionResult<{ pageDocId: string }>> {
  try {
    const value = parse(createSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    const { data, error } = await supabase.rpc("create_blank_cw_page", {
      p_lecture_id: value.lectureId, p_after_page_doc_id: value.afterPageDocId ?? undefined, p_title: value.title,
    });
    if (error || !data) throw new Error(error?.message ?? "SAVE_FAILED");
    revalidatePath("/[locale]/dashboard/courseware/lectures/[lectureId]", "page");
    return { ok: true, data: { pageDocId: data } };
  } catch (error) { return actionError(error, codes); }
}

export async function saveFormalManualPageAction(input: z.input<typeof saveSchema>): Promise<ActionResult<{ revisionNo: number }>> {
  try {
    const value = parse(saveSchema, input);
    const { supabase } = await authorizedClient("courseware.page.edit");
    // A client validation receipt is display state. Recompute from the payload
    // before saving, as the shared microcourse authoring path does.
    const doc = structuredClone(value.doc);
    doc.layout.blocks = doc.layout.blocks.map((block) => {
      if (block.type !== "game") return block;
      const trusted = validateGameCoursewareContent(block.game.gameId, block.game.contentVersion, block.game.payload);
      return { ...block, game: { ...block.game, ...trusted } };
    });
    const { data, error } = await supabase.rpc("save_cw_manual_composition_page", {
      p_page_doc_id: value.pageDocId, p_track: value.track, p_doc: doc as unknown as Json,
      p_base_revision_no: value.baseRevisionNo, p_note: value.note,
    });
    if (error || !data?.[0]) throw new Error(error?.message ?? "SAVE_FAILED");
    return { ok: true, data: { revisionNo: data[0].revision_no } };
  } catch (error) { return actionError(error, codes); }
}

/** The same authored Sudoku component, with the formal course editor's permission. */
export async function createFormalGameComponentAction(input: {
  gameId: string; contentVersion: string;
}): Promise<ActionResult<{ game: GamePageDoc }>> {
  try {
    const value = parse(z.object({ gameId: requiredText(80), contentVersion: requiredText(100) }).strict(), input);
    await authorizedClient("courseware.page.edit");
    if (!gameCoursewareContractsForSurface("microcourse").some((contract) =>
      contract.gameId === value.gameId && contract.contentVersion === value.contentVersion)) {
      throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
    }
    const trusted = validateGameCoursewareContent(value.gameId, value.contentVersion,
      createDefaultGameCoursewarePayload(value.gameId, value.contentVersion));
    const game = gamePageDocSchema.parse({ docVersion: "game-page-v1",
      canvas: { width: 960, height: 720, backgroundColor: "#ffffff" }, ...value, ...trusted });
    return { ok: true, data: { game } };
  } catch (error) { return actionError(error, ["UNKNOWN_GAME_COURSEWARE_CONTRACT", ...codes]); }
}
