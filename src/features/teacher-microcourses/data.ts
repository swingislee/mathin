import "server-only";

import { z } from "zod";
import { buildH5EntryUrl, type ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import {
  teacherMicrocoursePageDocSchema,
  type TeacherMicrocoursePageDoc,
} from "./page-doc";
import {
  bindingObjectLookupRevisionIds,
  resolveTeacherMicrocourseBindingDescriptors,
  type TeacherMicrocourseAssetObjectDescriptor,
} from "./binding-resolution";

type RpcClient = Awaited<ReturnType<typeof createClient>>;
type UntypedRpc = (name: string, args?: Record<string, unknown>) => Promise<{
  data: unknown;
  error: { message: string } | null;
}>;

function rpc(client: RpcClient): UntypedRpc {
  return (client.rpc as unknown as UntypedRpc).bind(client);
}

const uuid = z.uuid();
const metadataSchema = z.object({
  revisionId: uuid,
  revisionNo: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  grade: z.number().int(),
  courseSeason: z.number().int().nullable(),
  classType: z.string(),
  primaryTopicSlug: z.string(),
  keywords: z.array(z.string()),
  createdAt: z.string(),
});

const workflowSchema = z.object({
  stage: z.enum(["idle", "editing", "in_review", "changes_requested", "ready_to_publish"]),
  currentReviewRound: z.number().int().nullable(),
  requiredReviewRounds: z.number().int().nullable(),
  activeReviewCycleId: uuid.nullable(),
  updatedAt: z.string(),
});

export const teacherMicrocourseSummarySchema = z.object({
  id: uuid,
  sourceSessionId: uuid,
  authorId: uuid,
  authorName: z.string(),
  variantName: z.string(),
  basedOnMicrocourseId: uuid.nullable(),
  basedOnMetadataRevisionId: uuid.nullable(),
  basedOnVariantName: z.string().nullable(),
  courseId: uuid,
  lectureId: uuid,
  courseStatus: z.string(),
  currentReleaseId: uuid.nullable(),
  draftMetadataRevisionId: uuid.nullable(),
  publishedMetadataRevisionId: uuid.nullable(),
  draftMetadata: metadataSchema.nullable(),
  publishedMetadata: metadataSchema.nullable(),
  workflow: workflowSchema.nullable(),
  firstPublishedAt: z.string().nullable(),
  lastPublishedAt: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  pageCount: z.number().int().nonnegative(),
  selectedForSession: z.boolean(),
  canEdit: z.boolean(),
});

export type TeacherMicrocourseSummary = z.infer<typeof teacherMicrocourseSummarySchema>;

export interface TeacherMicrocourseTopic {
  id: string;
  slug: string;
  titleZh: string;
  titleEn: string;
  enabled: boolean;
}

export async function listTeacherMicrocourseTopics(): Promise<TeacherMicrocourseTopic[]> {
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("list_teacher_microcourse_topics");
  if (error) throw new Error(error.message);
  const rows = z.array(z.object({
    id: uuid,
    slug: z.string(),
    title_zh: z.string(),
    title_en: z.string(),
    enabled: z.boolean(),
  })).parse(data ?? []);
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    titleZh: row.title_zh,
    titleEn: row.title_en,
    enabled: row.enabled,
  }));
}

export interface TeacherMicrocourseBinding {
  bindingKey: string;
  assetRevisionId: string;
  role: string | null;
  kind: string | null;
  storagePath: string | null;
}

export interface TeacherMicrocoursePage {
  pageDocId: string;
  pageNo: number;
  title: string;
  revisionId: string;
  revisionNo: number;
  doc: TeacherMicrocoursePageDoc;
  bindings: TeacherMicrocourseBinding[];
  bindingUrls: ResolvedBindingUrls;
}

export interface TeacherMicrocourseEditor extends TeacherMicrocourseSummary {
  topics: TeacherMicrocourseTopic[];
  pages: TeacherMicrocoursePage[];
}

const topicSchema = z.object({
  id: uuid,
  slug: z.string(),
  titleZh: z.string(),
  titleEn: z.string(),
  enabled: z.boolean(),
});

const bindingSchema = z.object({
  bindingKey: z.string().min(1),
  assetRevisionId: uuid,
  role: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  storagePath: z.string().nullable().optional(),
}).passthrough();

const editorSchema = teacherMicrocourseSummarySchema.extend({
  topics: z.array(topicSchema),
  pages: z.array(z.object({
    pageDocId: uuid,
    pageNo: z.number().int().positive(),
    title: z.string(),
    revisionId: uuid,
    revisionNo: z.number().int().positive(),
    doc: teacherMicrocoursePageDocSchema,
    bindings: z.array(bindingSchema),
  })),
});

async function h5EntryPath(objectHash: string): Promise<string> {
  try {
    const base = getSupabaseConfig().url.replace(/\/$/, "");
    const response = await fetch(
      `${base}/storage/v1/object/public/cw-h5/packages/${objectHash}/__mathin_manifest.json`,
      { cache: "force-cache" },
    );
    if (response.ok) {
      const manifest = z.object({ entryPath: z.string().min(1) }).safeParse(await response.json());
      if (manifest.success) return manifest.data.entryPath;
    }
  } catch {
    // A single-file teacher H5 always uses index.html; legacy packages normally
    // expose a manifest, but the fallback keeps a missing manifest visible.
  }
  return "index.html";
}

function normalizeBindings(bindings: readonly z.infer<typeof bindingSchema>[]): TeacherMicrocourseBinding[] {
  return bindings.map((binding) => ({
    bindingKey: binding.bindingKey,
    assetRevisionId: binding.assetRevisionId,
    role: binding.role ?? null,
    kind: binding.kind ?? null,
    storagePath: binding.storagePath ?? null,
  }));
}

/** Resolve every page in one DB lookup, one signed-URL batch and one H5 manifest pass. */
async function resolvePageBindingUrls(
  pages: readonly { pageDocId: string; bindings: readonly TeacherMicrocourseBinding[] }[],
): Promise<Map<string, ResolvedBindingUrls>> {
  const result = new Map(pages.map((page) => [page.pageDocId, {} as ResolvedBindingUrls]));
  const bindings = pages.flatMap((page) => page.bindings);
  if (bindings.length === 0) return result;
  const admin = createAdminClient();
  const lookupRevisionIds = bindingObjectLookupRevisionIds(bindings);
  const objectByRevision = new Map<string, TeacherMicrocourseAssetObjectDescriptor>();
  if (lookupRevisionIds.length > 0) {
    const { data, error } = await admin
      .from("cw_asset_revisions")
      .select("id,object:cw_asset_objects!cw_asset_revisions_object_id_fkey(sha256,storage_path,kind)")
      .in("id", lookupRevisionIds)
      .returns<Array<{ id: string; object: { sha256: string; storage_path: string; kind: string } | null }>>();
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.object) objectByRevision.set(row.id, {
        sha256: row.object.sha256,
        storagePath: row.object.storage_path,
        kind: row.object.kind,
      });
    }
  }

  const resolvedByPage = new Map(pages.map((page) => [
    page.pageDocId,
    resolveTeacherMicrocourseBindingDescriptors(page.bindings, objectByRevision),
  ]));
  const resolved = [...resolvedByPage.values()].flat();
  const paths = [...new Set(resolved
    .filter((item) => item.kind !== "h5" && item.storagePath)
    .map((item) => item.storagePath!))];
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data, error } = await admin.storage.from("cw-objects").createSignedUrls(paths, 6 * 60 * 60);
    if (error) throw new Error(error.message);
    for (const item of data ?? []) if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
  }

  const h5Hashes = [...new Set(resolved
    .filter((item) => item.kind === "h5" && item.objectHash)
    .map((item) => item.objectHash!))];
  const h5Entries = new Map(await Promise.all(h5Hashes.map(async (objectHash) => [
    objectHash,
    await h5EntryPath(objectHash),
  ] as const)));

  for (const [pageDocId, pageBindings] of resolvedByPage) {
    const urls: Record<string, string> = {};
    for (const item of pageBindings) {
      if (item.kind === "h5" && item.objectHash) {
        urls[item.bindingKey] = buildH5EntryUrl(item.objectHash, h5Entries.get(item.objectHash) ?? "index.html", null);
      } else if (item.storagePath) {
        const url = signedByPath.get(item.storagePath);
        if (url) urls[item.bindingKey] = url;
      }
    }
    result.set(pageDocId, urls);
  }
  return result;
}

export async function getTeacherMicrocourseForSession(sessionId: string): Promise<TeacherMicrocourseSummary | null> {
  const parsed = uuid.safeParse(sessionId);
  if (!parsed.success) throw new Error("VALIDATION");
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_teacher_microcourse_for_session", { p_session_id: parsed.data });
  if (error) throw new Error(error.message);
  return data === null ? null : teacherMicrocourseSummarySchema.parse(data);
}

export async function listTeacherMicrocourseVariants(sessionId: string): Promise<TeacherMicrocourseSummary[]> {
  const parsed = uuid.safeParse(sessionId);
  if (!parsed.success) throw new Error("VALIDATION");
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("list_teacher_microcourse_variants", {
    p_session_id: parsed.data,
  });
  if (error) throw new Error(error.message);
  return z.array(teacherMicrocourseSummarySchema).parse(data ?? []);
}

const teacherMicrocourseSessionContextSchema = z.object({
  id: uuid,
  title: z.string(),
  classroomId: uuid,
  classroomName: z.string(),
  lectureId: uuid.nullable(),
  scheduledAt: z.string().nullable(),
  coursewareFrozenAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  selectedMicrocourseId: uuid.nullable(),
  canCreate: z.boolean(),
  canSelect: z.boolean(),
});

export type TeacherMicrocourseSessionContext = z.infer<typeof teacherMicrocourseSessionContextSchema>;

export async function getTeacherMicrocourseSessionContext(
  sessionId: string,
): Promise<TeacherMicrocourseSessionContext | null> {
  const parsed = uuid.safeParse(sessionId);
  if (!parsed.success) throw new Error("VALIDATION");
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_teacher_microcourse_session_context", {
    p_session_id: parsed.data,
  });
  if (error) throw new Error(error.message);
  return data === null ? null : teacherMicrocourseSessionContextSchema.parse(data);
}

export async function getTeacherMicrocourseEditor(microcourseId: string): Promise<TeacherMicrocourseEditor> {
  const parsed = uuid.safeParse(microcourseId);
  if (!parsed.success) throw new Error("VALIDATION");
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_teacher_microcourse_editor", { p_microcourse_id: parsed.data });
  if (error) throw new Error(error.message);
  const editor = editorSchema.parse(data);
  const normalizedPages = editor.pages.map((page) => ({ ...page, bindings: normalizeBindings(page.bindings) }));
  const bindingUrlsByPage = await resolvePageBindingUrls(normalizedPages);
  const pages = normalizedPages.map((page): TeacherMicrocoursePage => ({
    ...page,
    bindingUrls: bindingUrlsByPage.get(page.pageDocId) ?? {},
  }));
  return { ...editor, pages };
}

export interface TeacherMicrocourseSourceLecture {
  familyId: string;
  familyTitle: string;
  courseId: string;
  courseTitle: string;
  lectureId: string;
  lectureNo: number;
  lectureTitle: string;
  releaseId: string;
  pageCount: number;
}

export async function listTeacherMicrocourseSourceLectures(input: {
  courseId: string;
  limit?: number;
}): Promise<TeacherMicrocourseSourceLecture[]> {
  const value = z.object({
    courseId: uuid,
    limit: z.number().int().min(1).max(200).default(100),
  }).parse(input);
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("list_teacher_microcourse_source_lectures", {
    p_course_id: value.courseId,
    p_limit: value.limit,
  });
  if (error) throw new Error(error.message);
  const rows = z.array(z.object({
    family_id: uuid,
    family_title: z.string(),
    course_id: uuid,
    course_title: z.string(),
    lecture_id: uuid,
    lecture_no: z.number().int().positive(),
    lecture_title: z.string(),
    release_id: uuid,
    page_count: z.number().int().positive(),
  })).parse(data ?? []);
  return rows.map((row) => ({
    familyId: row.family_id,
    familyTitle: row.family_title,
    courseId: row.course_id,
    courseTitle: row.course_title,
    lectureId: row.lecture_id,
    lectureNo: row.lecture_no,
    lectureTitle: row.lecture_title,
    releaseId: row.release_id,
    pageCount: row.page_count,
  }));
}

export interface TeacherMicrocourseReviewQueueItem {
  reviewCycleId: string;
  microcourseId: string;
  title: string;
  authorId: string;
  authorName: string;
  grade: number;
  courseSeason: number | null;
  classType: string;
  primaryTopicSlug: string;
  primaryTopicTitleZh: string;
  primaryTopicTitleEn: string;
  keywords: string[];
  reviewRoundNo: number;
  requiredReviewRounds: number;
  submittedAt: string;
  submissionNote: string;
}

export async function listTeacherMicrocourseReviewQueue(): Promise<TeacherMicrocourseReviewQueueItem[]> {
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("list_teacher_microcourse_review_queue");
  if (error) throw new Error(error.message);
  const rows = z.array(z.object({
    review_cycle_id: uuid,
    microcourse_id: uuid,
    title: z.string(),
    author_id: uuid,
    author_name: z.string(),
    grade: z.number().int(),
    course_season: z.number().int().nullable(),
    class_type: z.string(),
    primary_topic_slug: z.string(),
    primary_topic_title_zh: z.string(),
    primary_topic_title_en: z.string(),
    keywords: z.array(z.string()),
    review_round_no: z.number().int(),
    required_review_rounds: z.number().int(),
    submitted_at: z.string(),
    submission_note: z.string(),
  })).parse(data ?? []);
  return rows.map((row) => ({
    reviewCycleId: row.review_cycle_id,
    microcourseId: row.microcourse_id,
    title: row.title,
    authorId: row.author_id,
    authorName: row.author_name,
    grade: row.grade,
    courseSeason: row.course_season,
    classType: row.class_type,
    primaryTopicSlug: row.primary_topic_slug,
    primaryTopicTitleZh: row.primary_topic_title_zh,
    primaryTopicTitleEn: row.primary_topic_title_en,
    keywords: row.keywords,
    reviewRoundNo: row.review_round_no,
    requiredReviewRounds: row.required_review_rounds,
    submittedAt: row.submitted_at,
    submissionNote: row.submission_note,
  }));
}

const reviewMetadataSchema = metadataSchema.omit({ createdAt: true }).extend({
  primaryTopicTitleZh: z.string(),
  primaryTopicTitleEn: z.string(),
});

export interface TeacherMicrocourseReview {
  reviewCycleId: string;
  microcourseId: string;
  authorId: string;
  authorName: string;
  status: string;
  reviewRoundNo: number;
  requiredReviewRounds: number;
  submissionNote: string;
  submittedAt: string;
  metadata: z.infer<typeof reviewMetadataSchema>;
  pages: TeacherMicrocoursePage[];
}

export async function getTeacherMicrocourseReview(reviewCycleId: string): Promise<TeacherMicrocourseReview> {
  const parsed = uuid.safeParse(reviewCycleId);
  if (!parsed.success) throw new Error("VALIDATION");
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_teacher_microcourse_review", { p_review_cycle_id: parsed.data });
  if (error) throw new Error(error.message);
  const review = z.object({
    reviewCycleId: uuid,
    microcourseId: uuid,
    authorId: uuid,
    authorName: z.string(),
    status: z.string(),
    reviewRoundNo: z.number().int(),
    requiredReviewRounds: z.number().int(),
    submissionNote: z.string(),
    submittedAt: z.string(),
    metadata: reviewMetadataSchema,
    pages: z.array(z.object({
      pageDocId: uuid,
      pageNo: z.number().int().positive(),
      title: z.string(),
      revisionId: uuid,
      revisionNo: z.number().int().positive(),
      doc: teacherMicrocoursePageDocSchema,
      bindings: z.array(bindingSchema),
    })),
  }).parse(data);
  const normalizedPages = review.pages.map((page) => ({ ...page, bindings: normalizeBindings(page.bindings) }));
  const bindingUrlsByPage = await resolvePageBindingUrls(normalizedPages);
  const pages = normalizedPages.map((page): TeacherMicrocoursePage => ({
    ...page,
    bindingUrls: bindingUrlsByPage.get(page.pageDocId) ?? {},
  }));
  return { ...review, pages };
}

export async function isTeacherMicrocourseReviewCycle(reviewCycleId: string): Promise<boolean> {
  const parsed = uuid.safeParse(reviewCycleId);
  if (!parsed.success) return false;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teacher_microcourse_review_snapshots")
    .select("review_cycle_id")
    .eq("review_cycle_id", parsed.data)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

export async function loadTeacherMicrocourseH5Html(artifactId: string): Promise<string> {
  const parsed = uuid.safeParse(artifactId);
  if (!parsed.success) throw new Error("VALIDATION");
  const supabase = await createClient();
  const { data, error } = await rpc(supabase)("get_teacher_microcourse_h5_artifact", { p_artifact_id: parsed.data });
  if (error) throw new Error(error.message);
  const artifact = z.object({
    privatePath: z.string(),
    publicPath: z.string().nullable(),
  }).parse(data);
  const admin = createAdminClient();
  const bucket = artifact.publicPath ? "cw-h5" : "cw-h5-drafts";
  const path = artifact.publicPath ?? artifact.privatePath;
  const { data: blob, error: downloadError } = await admin.storage.from(bucket).download(path);
  if (downloadError || !blob) throw new Error(downloadError?.message ?? "H5_DRAFT_MISSING");
  return blob.text();
}
