"use server";

import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import {
  GAME_PAGE_DOC_VERSION,
  gamePageDocSchema,
  type GamePageDoc,
} from "@/features/courseware-doc/game-page-schema";
import {
  coursewareCompositionPageSchema,
  type CoursewareCompositionH5,
} from "@/features/courseware-doc/composition-page-schema";
import { createDefaultGameCoursewarePayload } from "@/features/games/courseware/contracts";
import { gameCoursewareContractsForSurface } from "@/features/games/courseware/registry";
import { validateGameCoursewareContent } from "@/features/games/courseware/server";
import { toolCoursewareContractsForSurface } from "@/features/tools/courseware/registry";
import { authorizedClient } from "@/features/school/actions/guards";
import {
  COMMON_CODES,
  intInRange,
  parse,
  requiredText,
  text,
  uuid,
} from "@/features/school/actions/schemas";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { microcourseH5Bytes, normalizeMicrocourseH5 } from "./h5";
import { teacherImageDimensions } from "./image-metadata";
import { listTeacherMicrocourseSourceLectures, loadTeacherMicrocourseH5Html } from "./data";
import {
  teacherMicrocoursePageDocSchema,
  type TeacherMicrocoursePageDoc,
} from "./page-doc";

type RpcClient = { rpc: unknown };
function rpc<T>(client: RpcClient, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: T; error: { message: string } | null }>)(name, args);
}

const topicSlug = z.string().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function sanitizeTeacherMicrocoursePage(doc: TeacherMicrocoursePageDoc): TeacherMicrocoursePageDoc {
  const next = structuredClone(doc);
  const walk = (nodes: typeof doc.overlay.nodes) => {
    for (const node of nodes) {
      if (node.content?.kind === "rich_text") {
        node.content.html = sanitizeHtml(node.content.html ?? "", {
          allowedTags: [...sanitizeHtml.defaults.allowedTags, "span"],
          allowedAttributes: { span: ["class"] },
          allowedClasses: { span: ["math-tex"] },
          allowedSchemes: [],
          disallowedTagsMode: "discard",
        });
        node.content.sanitized = true;
      }
      walk(node.children);
    }
  };
  walk(next.overlay.nodes);
  return coursewareCompositionPageSchema.parse(next);
}
const metadataSchema = z.object({
  sourceSessionId: uuid.optional(),
  microcourseId: uuid.optional(),
  variantName: requiredText(120).optional(),
  title: requiredText(100),
  description: text(2000),
  grade: intInRange(1, 9),
  courseSeason: intInRange(1, 4).nullable(),
  classType: text(40),
  primaryTopicSlug: topicSlug,
  keywords: z.array(requiredText(32)).max(12),
}).refine((value) => Boolean(value.sourceSessionId) !== Boolean(value.microcourseId), {
  message: "exactly one identity is required",
});

const AUTHOR_CODES = [
  "FEATURE_DISABLED",
  "MICROCOURSE_NOT_FOUND",
  "PAGE_NOT_FOUND",
  "AFTER_PAGE_NOT_FOUND",
  "VERSION_CONFLICT",
  "PAGE_MODE_IMMUTABLE",
  "SOURCE_PROVENANCE_IMMUTABLE",
  "INVALID_PAGE_DOC",
  "INVALID_SUDOKU_PUZZLE",
  "UNKNOWN_GAME_COURSEWARE_CONTRACT",
  "UNKNOWN_TOOL_COURSEWARE_CONTRACT",
  "GAME_PAGE_VALIDATION_FAILED",
  "GAME_PAGE_NOT_PUBLISHABLE",
  "H5_ARTIFACT_NOT_FOUND",
  "H5_UPLOAD_FAILED",
  "H5_TOO_LARGE",
  "H5_ARTIFACT_SNAPSHOT_MISMATCH",
  "MICROCOURSE_PAGE_LIMIT",
  "MICROCOURSE_PAGES_REQUIRED",
  "MICROCOURSE_VARIANT_SESSION_MISMATCH",
  "SESSION_COURSEWARE_ALREADY_FROZEN",
  "PAGE_ORDER_MISMATCH",
  "OBJECT_METADATA_CONFLICT",
  ...COMMON_CODES,
] as const;

export async function createTeacherMicrocourseAction(
  input: z.input<typeof metadataSchema>,
): Promise<ActionResult<{ microcourseId: string }>> {
  try {
    const value = parse(metadataSchema, input);
    if (!value.sourceSessionId || !value.variantName) throw new Error("VALIDATION");
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { data, error } = await rpc<string>(supabase, "create_teacher_microcourse_variant", {
      p_source_session_id: value.sourceSessionId,
      p_variant_name: value.variantName,
      p_title: value.title,
      p_description: value.description,
      p_grade: value.grade,
      p_course_season: value.courseSeason,
      p_class_type: value.classType,
      p_primary_topic_slug: value.primaryTopicSlug,
      p_keywords: value.keywords,
    });
    if (error || !data) throw new Error(error?.message ?? "CREATE_FAILED");
    return { ok: true, data: { microcourseId: data } };
  } catch (error) {
    return actionError(error, ["CREATE_FAILED", ...AUTHOR_CODES]);
  }
}

const variantIdentitySchema = z.object({
  microcourseId: uuid,
  variantName: requiredText(120),
}).strict();

export async function forkTeacherMicrocourseVariantAction(input: {
  microcourseId: string;
  variantName: string;
}): Promise<ActionResult<{ microcourseId: string }>> {
  try {
    const value = parse(variantIdentitySchema, input);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { data, error } = await rpc<string>(supabase, "fork_teacher_microcourse_variant", {
      p_source_microcourse_id: value.microcourseId,
      p_variant_name: value.variantName,
    });
    if (error || !data) throw new Error(error?.message ?? "FORK_FAILED");
    return { ok: true, data: { microcourseId: data } };
  } catch (error) {
    return actionError(error, ["FORK_FAILED", ...AUTHOR_CODES]);
  }
}

export async function renameTeacherMicrocourseVariantAction(input: {
  microcourseId: string;
  variantName: string;
}): Promise<ActionResult<null>> {
  try {
    const value = parse(variantIdentitySchema, input);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { error } = await rpc<null>(supabase, "rename_teacher_microcourse_variant", {
      p_microcourse_id: value.microcourseId,
      p_variant_name: value.variantName,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, AUTHOR_CODES);
  }
}

export async function selectTeacherMicrocourseVariantAction(input: {
  sessionId: string;
  microcourseId: string;
}): Promise<ActionResult<null>> {
  try {
    const value = parse(z.object({ sessionId: uuid, microcourseId: uuid }).strict(), input);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { error } = await rpc<null>(supabase, "select_teacher_microcourse_variant", {
      p_session_id: value.sessionId,
      p_microcourse_id: value.microcourseId,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, AUTHOR_CODES);
  }
}

export async function saveTeacherMicrocourseMetadataAction(
  input: z.input<typeof metadataSchema>,
): Promise<ActionResult<{ revisionId: string }>> {
  try {
    const value = parse(metadataSchema, input);
    if (!value.microcourseId) throw new Error("VALIDATION");
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { data, error } = await rpc<string>(supabase, "save_teacher_microcourse_metadata", {
      p_microcourse_id: value.microcourseId,
      p_title: value.title,
      p_description: value.description,
      p_grade: value.grade,
      p_course_season: value.courseSeason,
      p_class_type: value.classType,
      p_primary_topic_slug: value.primaryTopicSlug,
      p_keywords: value.keywords,
    });
    if (error || !data) throw new Error(error?.message ?? "SAVE_FAILED");
    return { ok: true, data: { revisionId: data } };
  } catch (error) {
    return actionError(error, ["SAVE_FAILED", ...AUTHOR_CODES]);
  }
}

const sourceSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blank") }).strict(),
  z.object({
    kind: z.literal("published-page"),
    releaseId: uuid,
    pageDocId: uuid,
    revisionId: uuid,
  }).strict(),
]);

export async function createTeacherCompositionPageAction(input: {
  microcourseId: string;
  afterPageDocId: string | null;
  title: string;
  source: z.input<typeof sourceSelectionSchema>;
}): Promise<ActionResult<{ pageId: string }>> {
  try {
    const value = parse(z.object({
      microcourseId: uuid,
      afterPageDocId: uuid.nullable(),
      title: requiredText(200),
      source: sourceSelectionSchema,
    }), input);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const source = value.source.kind === "published-page" ? value.source : null;
    const { data, error } = await rpc<string>(supabase, "create_teacher_microcourse_composition_page", {
      p_microcourse_id: value.microcourseId,
      p_after_page_doc_id: value.afterPageDocId,
      p_title: value.title,
      p_source_release_id: source?.releaseId ?? null,
      p_source_page_doc_id: source?.pageDocId ?? null,
      p_source_revision_id: source?.revisionId ?? null,
    });
    if (error || !data) throw new Error(error?.message ?? "CREATE_PAGE_FAILED");
    return { ok: true, data: { pageId: data } };
  } catch (error) {
    return actionError(error, [
      "CREATE_PAGE_FAILED",
      "INVALID_SOURCE_SELECTION",
      "SOURCE_PAGE_NOT_CURRENT_PUBLISHED",
      "SOURCE_BINDING_SNAPSHOT_MISMATCH",
      ...AUTHOR_CODES,
    ]);
  }
}

export async function createTeacherCompositionPagesFromLectureAction(input: {
  microcourseId: string;
  afterPageDocId: string | null;
  sourceReleaseId: string;
  sourceLectureId: string;
}): Promise<ActionResult<{ firstPageId: string; lastPageId: string; pageCount: number }>> {
  try {
    const value = parse(z.object({
      microcourseId: uuid,
      afterPageDocId: uuid.nullable(),
      sourceReleaseId: uuid,
      sourceLectureId: uuid,
    }).strict(), input);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { data, error } = await rpc<Array<{
      first_page_id: string;
      last_page_id: string;
      page_count: number;
    }>>(supabase, "create_teacher_microcourse_composition_pages_from_lecture", {
      p_microcourse_id: value.microcourseId,
      p_after_page_doc_id: value.afterPageDocId,
      p_source_release_id: value.sourceReleaseId,
      p_source_lecture_id: value.sourceLectureId,
    });
    const created = data?.[0];
    if (error || !created) throw new Error(error?.message ?? "CREATE_PAGES_FAILED");
    return {
      ok: true,
      data: {
        firstPageId: created.first_page_id,
        lastPageId: created.last_page_id,
        pageCount: created.page_count,
      },
    };
  } catch (error) {
    return actionError(error, [
      "CREATE_PAGES_FAILED",
      "SOURCE_LECTURE_NOT_CURRENT_PUBLISHED",
      "SOURCE_LECTURE_SNAPSHOT_INVALID",
      "SOURCE_PAGE_NOT_CURRENT_PUBLISHED",
      "SOURCE_BINDING_SNAPSHOT_MISMATCH",
      ...AUTHOR_CODES,
    ]);
  }
}

const gameContractId = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export async function createTeacherGameComponentAction(input: {
  microcourseId: string;
  gameId: string;
  contentVersion: string;
}): Promise<ActionResult<{ game: GamePageDoc }>> {
  try {
    const value = parse(z.object({
      microcourseId: uuid,
      gameId: gameContractId,
      contentVersion: gameContractId,
    }).strict(), input);
    await authorizedClient("courseware.microcourse.author");
    const authorable = gameCoursewareContractsForSurface("microcourse").some((contract) => (
      contract.gameId === value.gameId && contract.contentVersion === value.contentVersion
    ));
    if (!authorable) throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
    const trusted = validateGameCoursewareContent(
      value.gameId,
      value.contentVersion,
      createDefaultGameCoursewarePayload(value.gameId, value.contentVersion),
    );
    const game = gamePageDocSchema.parse({
      docVersion: GAME_PAGE_DOC_VERSION,
      canvas: { width: 960, height: 720, backgroundColor: "#ffffff" },
      gameId: value.gameId,
      contentVersion: value.contentVersion,
      payload: trusted.payload,
      validation: trusted.validation,
    });
    return { ok: true, data: { game } };
  } catch (error) {
    return actionError(error, AUTHOR_CODES);
  }
}

export async function createTeacherGamePageAction(input: {
  microcourseId: string;
  afterPageDocId: string | null;
  title: string;
  gameId: string;
  contentVersion: string;
}): Promise<ActionResult<{ pageId: string }>> {
  try {
    const value = parse(z.object({
      microcourseId: uuid,
      afterPageDocId: uuid.nullable(),
      title: requiredText(200),
      gameId: gameContractId,
      contentVersion: gameContractId,
    }), input);
    const authorable = gameCoursewareContractsForSurface("microcourse").some((contract) => (
      contract.gameId === value.gameId && contract.contentVersion === value.contentVersion
    ));
    if (!authorable) throw new Error("UNKNOWN_GAME_COURSEWARE_CONTRACT");
    const { user } = await authorizedClient("courseware.microcourse.author");
    const trusted = validateGameCoursewareContent(
      value.gameId,
      value.contentVersion,
      createDefaultGameCoursewarePayload(value.gameId, value.contentVersion),
    );
    const doc = gamePageDocSchema.parse({
      docVersion: GAME_PAGE_DOC_VERSION,
      canvas: { width: 960, height: 720, backgroundColor: "#ffffff" },
      gameId: value.gameId,
      contentVersion: value.contentVersion,
      payload: trusted.payload,
      validation: trusted.validation,
    });
    const admin = createAdminClient();
    const { data, error } = await rpc<Array<{ page_id: string }>>(
      admin,
      "create_teacher_microcourse_game_page",
      {
        p_actor_id: user.id,
        p_microcourse_id: value.microcourseId,
        p_after_page_doc_id: value.afterPageDocId,
        p_title: value.title,
        p_doc: doc,
      },
    );
    if (error || !data?.[0]?.page_id) throw new Error(error?.message ?? "CREATE_PAGE_FAILED");
    return { ok: true, data: { pageId: data[0].page_id } };
  } catch (error) {
    return actionError(error, ["CREATE_PAGE_FAILED", ...AUTHOR_CODES]);
  }
}

export async function createTeacherH5ComponentArtifactAction(input: {
  microcourseId: string;
  html: string;
}): Promise<ActionResult<{ h5: CoursewareCompositionH5 }>> {
  try {
    const value = parse(z.object({
      microcourseId: uuid,
      html: z.string().min(1).max(5_242_880),
    }).strict(), input);
    const { user, supabase } = await authorizedClient("courseware.microcourse.author");
    const normalized = normalizeMicrocourseH5(value.html);
    const bytes = microcourseH5Bytes(normalized);
    if (bytes.byteLength > 5 * 1_024 * 1_024) throw new Error("H5_TOO_LARGE");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const privatePath = `${user.id}/${value.microcourseId}/${sha256}/index.html`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage.from("cw-h5-drafts").upload(
      privatePath,
      bytes,
      { contentType: "text/html", cacheControl: "0", upsert: false },
    );
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
      throw new Error("H5_UPLOAD_FAILED");
    }
    const { data: artifactId, error: artifactError } = await rpc<string>(
      supabase,
      "register_teacher_microcourse_h5_artifact",
      {
        p_microcourse_id: value.microcourseId,
        p_sha256: sha256,
        p_byte_count: bytes.byteLength,
        p_private_path: privatePath,
      },
    );
    if (artifactError || !artifactId) throw new Error(artifactError?.message ?? "H5_REGISTER_FAILED");
    return {
      ok: true,
      data: {
        h5: { artifactId, sha256, byteCount: bytes.byteLength, entryPath: "index.html" },
      },
    };
  } catch (error) {
    return actionError(error, ["H5_REGISTER_FAILED", ...AUTHOR_CODES]);
  }
}

export async function listTeacherMicrocourseSourceLecturesAction(input: {
  courseId: string;
  limit?: number;
}) {
  await authorizedClient("courseware.microcourse.author");
  return listTeacherMicrocourseSourceLectures(input);
}

export async function loadTeacherMicrocourseH5HtmlAction(artifactId: string): Promise<string> {
  await authorizedClient("courseware.microcourse.author");
  return loadTeacherMicrocourseH5Html(parse(uuid, artifactId));
}

export async function saveTeacherMicrocoursePageAction(input: {
  pageDocId: string;
  doc: unknown;
  baseRevisionNo: number;
  title: string;
  note: string;
}): Promise<ActionResult<{ revisionNo: number; doc: TeacherMicrocoursePageDoc }>> {
  try {
    const value = parse(z.object({
      pageDocId: uuid,
      doc: teacherMicrocoursePageDocSchema,
      baseRevisionNo: intInRange(1, 100_000),
      title: requiredText(200),
      note: text(1000),
    }), input);
    const doc = sanitizeTeacherMicrocoursePage(value.doc);
    const { user } = await authorizedClient("courseware.microcourse.author");
    const trustedDoc = structuredClone(doc);
    const toolContracts = toolCoursewareContractsForSurface("microcourse");
    trustedDoc.layout.blocks = trustedDoc.layout.blocks.map((block) => {
      if (block.type === "tool") {
        const authorable = toolContracts.some((contract) => (
          contract.toolId === block.tool.toolId
            && contract.contentVersion === block.tool.contentVersion
        ));
        if (!authorable) throw new Error("UNKNOWN_TOOL_COURSEWARE_CONTRACT");
        return block;
      }
      if (block.type !== "game") return block;
      const trusted = validateGameCoursewareContent(
        block.game.gameId,
        block.game.contentVersion,
        block.game.payload,
      );
      return {
        ...block,
        game: gamePageDocSchema.parse({
          ...block.game,
          payload: trusted.payload,
          validation: trusted.validation,
        }),
      };
    });
    const parsedTrustedDoc = coursewareCompositionPageSchema.parse(trustedDoc);
    const admin = createAdminClient();
    const { data, error } = await rpc<Array<{ revision_no: number }>>(
      admin,
      "save_teacher_courseware_composition_page",
      {
        p_actor_id: user.id,
        p_page_doc_id: value.pageDocId,
        p_doc: parsedTrustedDoc,
        p_base_revision_no: value.baseRevisionNo,
        p_title: value.title,
        p_note: value.note,
      },
    );
    if (error || !data?.[0]) throw new Error(error?.message ?? "SAVE_FAILED");
    return {
      ok: true,
      data: { revisionNo: data[0].revision_no, doc: parsedTrustedDoc },
    };
  } catch (error) {
    return actionError(error, ["SAVE_FAILED", ...AUTHOR_CODES]);
  }
}

export async function reorderTeacherMicrocoursePagesAction(input: {
  microcourseId: string;
  pageIds: string[];
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({
      microcourseId: uuid,
      pageIds: z.array(uuid).min(1).max(200),
    }), input);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { error } = await rpc<null>(supabase, "reorder_teacher_microcourse_pages", {
      p_microcourse_id: value.microcourseId,
      p_page_ids: value.pageIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, AUTHOR_CODES);
  }
}

export async function deleteTeacherMicrocoursePageAction(pageDocId: string): Promise<ActionResult> {
  try {
    const value = parse(uuid, pageDocId);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { error } = await rpc<null>(supabase, "soft_delete_teacher_microcourse_page", {
      p_page_doc_id: value,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, AUTHOR_CODES);
  }
}

export async function uploadTeacherMicrocourseImageAction(input: {
  microcourseId: string;
  pageDocId: string;
  file: File;
}): Promise<ActionResult<{ bindingKey: string; url: string }>> {
  try {
    const value = parse(z.object({
      microcourseId: uuid,
      pageDocId: uuid,
      file: z.instanceof(File).refine((file) => (
        ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
        && file.size > 0
        && file.size <= 10_485_760
      )),
    }), input);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const bytes = new Uint8Array(await value.file.arrayBuffer());
    const dimensions = teacherImageDimensions(bytes, value.file.type);
    if (!dimensions) throw new Error("VALIDATION");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = `sha256/${sha256.slice(0, 2)}/${sha256}`;
    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage.from("cw-objects").upload(
      storagePath,
      bytes,
      { contentType: value.file.type, cacheControl: "31536000", upsert: false },
    );
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
      throw new Error(uploadError.message);
    }
    const { data, error } = await rpc<{ bindingKey: string }>(
      supabase,
      "register_teacher_microcourse_image",
      {
        p_microcourse_id: value.microcourseId,
        p_page_doc_id: value.pageDocId,
        p_sha256: sha256,
        p_mime: value.file.type,
        p_byte_count: value.file.size,
        p_width: dimensions.width,
        p_height: dimensions.height,
        p_name: value.file.name,
        p_role: "image",
      },
    );
    if (error || !data) throw new Error(error?.message ?? "UPLOAD_FAILED");
    const { data: signed, error: signedError } = await admin.storage
      .from("cw-objects")
      .createSignedUrl(storagePath, 3600);
    if (signedError || !signed?.signedUrl) throw new Error(signedError?.message ?? "SIGN_FAILED");
    return { ok: true, data: { bindingKey: data.bindingKey, url: signed.signedUrl } };
  } catch (error) {
    return actionError(error, ["UPLOAD_FAILED", "SIGN_FAILED", ...AUTHOR_CODES]);
  }
}

export async function freezeTeacherMicrocourseSourceSessionAction(
  microcourseId: string,
): Promise<ActionResult> {
  try {
    const value = parse(uuid, microcourseId);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { error } = await rpc<unknown>(
      supabase,
      "freeze_teacher_microcourse_source_session",
      { p_microcourse_id: value },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["SESSION_NOT_FOUND", "ALREADY_STARTED_OR_FROZEN", ...AUTHOR_CODES]);
  }
}

export async function submitTeacherMicrocourseReviewAction(input: {
  microcourseId: string;
  note: string;
}): Promise<ActionResult<{ reviewCycleId: string }>> {
  try {
    const value = parse(z.object({ microcourseId: uuid, note: text(1000) }), input);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { data, error } = await rpc<string>(supabase, "submit_teacher_microcourse_review", {
      p_microcourse_id: value.microcourseId,
      p_note: value.note,
    });
    if (error || !data) throw new Error(error?.message ?? "SUBMIT_FAILED");
    return { ok: true, data: { reviewCycleId: data } };
  } catch (error) {
    return actionError(error, [
      "SUBMIT_FAILED",
      "MICROCOURSE_METADATA_REQUIRED",
      "MICROCOURSE_REQUIRES_PAGE",
      "PAGE_TRACK_NOT_READY",
      "SUDOKU_UNIQUE_SOLUTION_REQUIRED",
      "H5_ARTIFACT_SNAPSHOT_MISMATCH",
      "INVALID_STAGE_FOR_SUBMIT",
      ...AUTHOR_CODES,
    ]);
  }
}

export async function withdrawTeacherMicrocourseReviewAction(
  reviewCycleId: string,
): Promise<ActionResult> {
  try {
    const value = parse(uuid, reviewCycleId);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { error } = await rpc<null>(supabase, "withdraw_teacher_microcourse_review", {
      p_review_cycle_id: value,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["REVIEW_CYCLE_NOT_FOUND", "INVALID_CYCLE_STATUS", ...AUTHOR_CODES]);
  }
}

export async function withdrawTeacherMicrocourseAction(
  microcourseId: string,
): Promise<ActionResult> {
  try {
    const value = parse(uuid, microcourseId);
    const { supabase } = await authorizedClient("courseware.microcourse.author");
    const { error } = await rpc<null>(supabase, "withdraw_teacher_microcourse", {
      p_microcourse_id: value,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, ["MICROCOURSE_NOT_PUBLISHED", ...AUTHOR_CODES]);
  }
}

const reviewPromotionSchema = z.object({
  microcourseId: uuid,
  finalApproval: z.boolean(),
  artifacts: z.array(z.object({
    artifactId: uuid,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    privatePath: z.string().min(1).max(1000),
    publicPath: z.string().min(1).max(1000),
  }).strict()).max(200),
}).strict();

export async function approveTeacherMicrocourseReviewAction(input: {
  reviewCycleId: string;
  note: string;
  reviewedPages: number[] | null;
}): Promise<ActionResult<{
  status: "in_review" | "published";
  reviewCycleId: string;
  releaseId: string | null;
}>> {
  try {
    const value = parse(z.object({
      reviewCycleId: uuid,
      note: text(1000),
      reviewedPages: z.array(intInRange(1, 200)).max(200).nullable(),
    }), input);
    const { supabase } = await authorizedClient("courseware.review");
    const { data: rawPlan, error: planError } = await rpc<unknown>(
      supabase,
      "prepare_teacher_microcourse_review_publish",
      { p_review_cycle_id: value.reviewCycleId },
    );
    if (planError) throw new Error(planError.message);
    const plan = reviewPromotionSchema.parse(rawPlan);
    const admin = createAdminClient();
    for (const artifact of plan.finalApproval ? plan.artifacts : []) {
      const { data: draft, error: downloadError } = await admin.storage
        .from("cw-h5-drafts")
        .download(artifact.privatePath);
      if (downloadError || !draft) throw new Error("H5_DRAFT_MISSING");
      const bytes = new Uint8Array(await draft.arrayBuffer());
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== artifact.sha256) throw new Error("H5_HASH_MISMATCH");
      const { error: uploadError } = await admin.storage.from("cw-h5").upload(
        artifact.publicPath,
        bytes,
        { contentType: "text/html", cacheControl: "31536000", upsert: false },
      );
      if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
        throw new Error("H5_PUBLISH_UPLOAD_FAILED");
      }
    }
    const { data, error } = await rpc<unknown>(
      supabase,
      "approve_teacher_microcourse_review",
      {
        p_review_cycle_id: value.reviewCycleId,
        p_note: value.note,
        p_reviewed_pages: value.reviewedPages,
      },
    );
    if (error) throw new Error(error.message);
    const result = z.object({
      status: z.enum(["in_review", "published"]),
      reviewCycleId: uuid,
      releaseId: uuid.nullable(),
    }).parse(data);
    return { ok: true, data: result };
  } catch (error) {
    return actionError(error, [
      "REVIEW_CYCLE_NOT_FOUND",
      "INVALID_CYCLE_STATUS",
      "FORBIDDEN_SELF_REVIEW",
      "H5_DRAFT_MISSING",
      "H5_HASH_MISMATCH",
      "H5_PUBLISH_UPLOAD_FAILED",
      "H5_PROMOTION_REQUIRED",
      "NOT_READY_TO_PUBLISH",
      ...COMMON_CODES,
    ]);
  }
}

export async function rejectTeacherMicrocourseReviewAction(input: {
  reviewCycleId: string;
  note: string;
  reviewedPages: number[] | null;
}): Promise<ActionResult> {
  try {
    const value = parse(z.object({
      reviewCycleId: uuid,
      note: requiredText(1000),
      reviewedPages: z.array(intInRange(1, 200)).max(200).nullable(),
    }), input);
    const { supabase } = await authorizedClient("courseware.review");
    const { error } = await rpc<null>(supabase, "reject_teacher_microcourse_review", {
      p_review_cycle_id: value.reviewCycleId,
      p_note: value.note,
      p_reviewed_pages: value.reviewedPages,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (error) {
    return actionError(error, [
      "REVIEW_CYCLE_NOT_FOUND",
      "INVALID_CYCLE_STATUS",
      "FORBIDDEN_SELF_REVIEW",
      "REVIEW_NOTE_REQUIRED",
      ...COMMON_CODES,
    ]);
  }
}
