import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionAssetUrls, getSessionH5BindingUrls, getSessionPageDocs } from "@/features/classroom/courseware/session-assets";
import { getSessionCoursewareTemplate } from "./courses";
import { courseware_template_array_schema, overlayArraySchema, resolveCourseware } from "./courseware-overlay";
import {
  materialFileBelongsToSession, materialPlanSchema, materialQuerySchema, materialSolutionsSchema,
  materialSummarySchema, materialVideoSchema, type MaterialContent, type MaterialFile,
} from "./session-materials-contract";

const URL_TTL = 900;

async function signMaterialFiles(files: Omit<MaterialFile, "url">[], sessionId: string, kind: "solution" | "lesson_plan"): Promise<MaterialFile[]> {
  const uniqueFiles = [...new Map(files.map(file => [file.path, file])).values()];
  const paths = uniqueFiles.filter(file => materialFileBelongsToSession(file.path, sessionId, kind)).map(file => file.path);
  if (!paths.length) return uniqueFiles.map(file => ({ ...file, url: null }));
  const client = await createClient();
  const { data } = await client.storage.from("prep-artifacts").createSignedUrls(paths, URL_TTL);
  const urls = new Map((data ?? []).map(file => [file.path, file.signedUrl]));
  return uniqueFiles.map(file => ({ ...file, url: urls.get(file.path) || null }));
}

async function readMaterialPages(sessionId: string) {
  const [pages, assets] = await Promise.all([getSessionPageDocs(sessionId), getSessionAssetUrls(sessionId)]);
  const h5 = await getSessionH5BindingUrls(pages);
  const urls = new Map(assets.map(asset => [asset.objectHash, asset.signedUrl]));
  return {
    docs: pages.map(page => ({ pageDocId: page.pageDocId, doc: page.doc,
      bindingUrls: Object.fromEntries(page.bindings.flatMap(binding => {
        const url = binding.kind === "h5" ? h5[binding.bindingKey] : urls.get(binding.objectHash);
        return url ? [[binding.bindingKey, url]] : [];
      })) })),
    pageLabels: Object.fromEntries(pages.map(page => [page.pageDocId, String(page.pageNo)])),
  };
}

export async function getSessionMaterials(input: z.infer<typeof materialQuerySchema>) {
  const client = await createClient();
  const { data, error } = await client.rpc("get_session_materials", {
    p_session_id: input.sessionId, p_classroom_id: input.classroomId, p_kind: input.kind,
  });
  if (error) throw new Error(error.message === "FORBIDDEN" ? "FORBIDDEN" : "MATERIALS_UNAVAILABLE");
  if (input.kind === "summary") return materialSummarySchema.parse(data);
  if (input.kind === "lesson_plan") {
    const result = materialPlanSchema.parse(data);
    return { ...result, files: await signMaterialFiles(result.files, input.sessionId, "lesson_plan") } satisfies MaterialContent;
  }
  if (input.kind === "rehearsal_video") return materialVideoSchema.parse(data);
  if (input.kind === "solution") {
    const result = materialSolutionsSchema.parse(data);
    const [files, preview] = await Promise.all([
      signMaterialFiles(result.files, input.sessionId, "solution"),
      result.records.length ? readMaterialPages(input.sessionId).catch(() => null) : Promise.resolve({ docs: [], pageLabels: {} }),
    ]);
    return { ...result, files, pages: preview?.docs ?? [], pageLabels: preview?.pageLabels ?? {}, previewFailed: !preview } satisfies MaterialContent;
  }
  const layout = z.object({ frozenAt: z.string().nullable(), pages: z.unknown(), overlay: z.unknown() }).parse(data);
  const [template, preview] = await Promise.all([
    layout.frozenAt ? Promise.resolve([]) : getSessionCoursewareTemplate(input.sessionId), readMaterialPages(input.sessionId),
  ]);
  const pages = layout.frozenAt ? courseware_template_array_schema.parse(layout.pages ?? [])
    : resolveCourseware(template, overlayArraySchema.parse(layout.overlay ?? []));
  // 页面来源已由课次 RPC 授权，仅签发该班级下实际引用的图片/视频。
  const paths = [...new Set(pages.flatMap(page => (page.type === "image" || page.type === "video")
    && page.path.startsWith(`${input.classroomId}/`) && !page.path.split("/").includes("..") ? [page.path] : []))];
  const signed = paths.length ? await createAdminClient().storage.from("courseware").createSignedUrls(paths, URL_TTL) : { data: [], error: null };
  if (signed.error) throw new Error("MATERIALS_UNAVAILABLE");
  return { kind: "courseware", pages, docs: preview.docs,
    overlayAssetUrls: Object.fromEntries((signed.data ?? []).flatMap(item => item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [])),
  } satisfies MaterialContent;
}
