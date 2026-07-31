import "server-only";

import { z } from "zod";
import {
  getSessionH5BindingUrls,
  type SessionDocBinding,
  type SessionPageDoc,
} from "@/features/classroom/courseware/session-assets";
import { pageDocSchema, type PageDoc } from "@/features/courseware-doc/schema";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  courseware_template_array_schema,
  overlayArraySchema,
  resolveCourseware,
  type CoursewareTemplatePage,
} from "./courseware-overlay";

const SIGNED_URL_TTL_SECONDS = 15 * 60;

const bindingSchema = z.object({
  bindingKey: z.string().min(1),
  objectHash: z.string().regex(/^[0-9a-f]{64}$/),
  kind: z.string().min(1),
  launchQuery: z
    .object({
      query: z.record(z.string(), z.array(z.string())),
      coursewareIdParam: z.string().nullable(),
    })
    .nullable(),
});

const layoutSchema = z.object({
  classroom_id: z.uuid(),
  lecture_id: z.uuid().nullable(),
  courseware_frozen_at: z.string().nullable(),
  courseware: z.unknown(),
  courseware_template: z.unknown(),
  courseware_overlay: z.unknown(),
});

const pageRowSchema = z.object({
  page_doc_id: z.uuid(),
  page_no: z.number().int().positive(),
  doc: pageDocSchema,
  bindings: z.array(bindingSchema),
});

const assetRowSchema = z.object({
  object_hash: z.string().regex(/^[0-9a-f]{64}$/),
  storage_path: z.string().min(1),
  kind: z.string().min(1),
});

export interface PreparationReviewCoursewareDoc {
  pageDocId: string;
  doc: PageDoc;
  bindingUrls: ResolvedBindingUrls;
}

export interface PreparationReviewCourseware {
  pages: CoursewareTemplatePage[];
  docs: PreparationReviewCoursewareDoc[];
  overlayAssetUrls: Record<string, string>;
}

async function signedUrlMap(
  bucket: "cw-objects" | "courseware",
  paths: readonly string[],
): Promise<Map<string, string>> {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrls(uniquePaths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).flatMap((item) =>
    item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : []));
}

export async function getSessionPreparationReviewCourseware(
  sessionId: string,
): Promise<PreparationReviewCourseware> {
  const supabase = await createClient();
  const [layoutResult, pagesResult, assetsResult] = await Promise.all([
    supabase.rpc("get_session_preparation_review_courseware", { p_session_id: sessionId }),
    supabase.rpc("get_session_preparation_review_page_docs", { p_session_id: sessionId }),
    supabase.rpc("list_session_preparation_review_resolved_assets", { p_session_id: sessionId }),
  ]);
  if (layoutResult.error) throw new Error(layoutResult.error.message);
  if (pagesResult.error) throw new Error(pagesResult.error.message);
  if (assetsResult.error) throw new Error(assetsResult.error.message);

  const layout = layoutSchema.parse(layoutResult.data?.[0]);
  const template = courseware_template_array_schema.parse(layout.courseware_template);
  const overlay = overlayArraySchema.parse(layout.courseware_overlay);
  const frozen = courseware_template_array_schema.parse(layout.courseware);
  const pages = layout.courseware_frozen_at ? frozen : resolveCourseware(template, overlay);
  const pageRows = z.array(pageRowSchema).parse(pagesResult.data ?? []);
  const assetRows = z.array(assetRowSchema).parse(assetsResult.data ?? []);

  const sessionDocs: SessionPageDoc[] = pageRows.map((row) => ({
    pageDocId: row.page_doc_id,
    pageNo: row.page_no,
    doc: row.doc,
    bindings: row.bindings as SessionDocBinding[],
  }));
  const h5BindingUrls = await getSessionH5BindingUrls(sessionDocs);
  const objectUrls = await signedUrlMap("cw-objects", assetRows.map((row) => row.storage_path));
  const urlByHash = new Map(assetRows.flatMap((row) => {
    const url = objectUrls.get(row.storage_path);
    return url ? [[row.object_hash, url] as const] : [];
  }));

  const overlayPaths = pages.flatMap((page) =>
    (page.type === "image" || page.type === "video")
      && page.path.startsWith(`${layout.classroom_id}/`)
      ? [page.path]
      : []);
  const overlayUrls = await signedUrlMap("courseware", overlayPaths);

  return {
    pages,
    docs: sessionDocs.map((page) => ({
      pageDocId: page.pageDocId,
      doc: page.doc,
      bindingUrls: Object.fromEntries(page.bindings.flatMap((binding) => {
        if (binding.kind === "h5") {
          const url = h5BindingUrls[binding.bindingKey];
          return url ? [[binding.bindingKey, url]] : [];
        }
        const url = urlByHash.get(binding.objectHash);
        return url ? [[binding.bindingKey, url]] : [];
      })),
    })),
    overlayAssetUrls: Object.fromEntries(overlayUrls),
  };
}
