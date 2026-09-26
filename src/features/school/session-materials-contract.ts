import { z } from "zod";
import type { CoursewareDoc } from "@/features/courseware-doc/document";
import type { CoursewareTemplatePage } from "./courseware-overlay";

export const MATERIAL_KINDS = ["lesson_plan", "solution", "rehearsal_video", "courseware"] as const;
export type MaterialKind = typeof MATERIAL_KINDS[number];
export const materialQuerySchema = z.object({
  sessionId: z.uuid(), classroomId: z.uuid(), kind: z.enum(["summary", ...MATERIAL_KINDS]),
});
export const materialFileSchema = z.object({ path: z.string(), name: z.string(), type: z.string(), size: z.number().nonnegative() });
export type MaterialFile = z.infer<typeof materialFileSchema> & { url: string | null };
export const materialSummarySchema = z.object({
  kind: z.literal("summary"), title: z.string().nullable(), classroomName: z.string(), scheduledAt: z.string().nullable(),
  lessonPlanCount: z.number(), solutionCount: z.number(), hasSolutionNotes: z.boolean(), hasVideo: z.boolean(),
});
export type MaterialSummary = z.infer<typeof materialSummarySchema>;
export const materialPlanSchema = z.object({
  kind: z.literal("lesson_plan"), files: z.array(materialFileSchema),
  plan: z.object({ id: z.uuid(), content: z.array(z.unknown()), status: z.enum(["draft", "pending", "approved", "changes_requested"]),
    revision: z.number(), updatedAt: z.string() }).nullable(),
});
export const materialSolutionsSchema = z.object({
  kind: z.literal("solution"), notes: z.string(), files: z.array(materialFileSchema),
  records: z.array(z.object({ id: z.uuid(), pageDocId: z.uuid().nullable(), revision: z.number(),
    content: z.record(z.string(), z.unknown()), updatedAt: z.string() })),
});
export const materialVideoSchema = z.object({ kind: z.literal("rehearsal_video"), url: z.string(), updatedAt: z.string().nullable() });
export interface MaterialPagePreview { pageDocId: string; doc: CoursewareDoc; bindingUrls: Record<string, string> }
export type MaterialContent =
  | (Omit<z.infer<typeof materialPlanSchema>, "files"> & { files: MaterialFile[] })
  | (Omit<z.infer<typeof materialSolutionsSchema>, "files"> & { files: MaterialFile[]; pages: MaterialPagePreview[]; pageLabels: Record<string, string>; previewFailed: boolean })
  | z.infer<typeof materialVideoSchema>
  | { kind: "courseware"; pages: CoursewareTemplatePage[]; docs: MaterialPagePreview[]; overlayAssetUrls: Record<string, string> };

/** 外链只接受显式 HTTPS，避免存量异常值成为可执行链接。 */
export function materialVideoHref(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function materialFileBelongsToSession(path: string, sessionId: string, kind: "solution" | "lesson_plan") {
  const prefix = `${sessionId}/${kind === "lesson_plan" ? "lesson-plan" : "solution"}/`;
  return path.startsWith(prefix) && !path.includes("\\")
    && !path.split("/").some(part => !part || part === "." || part === ".." || /%2e|%2f|%5c/i.test(part));
}

export function materialMessages(locale: string) {
  return locale.startsWith("en") ? {
    title: "Lesson materials", lesson_plan: "Lesson plan", solution: "Solutions", rehearsal_video: "Rehearsal video", courseware: "Courseware",
    loading: "Loading materials…", failed: "Materials could not be loaded.", forbidden: "You do not have access to these materials.", retry: "Retry", refresh: "Refresh", close: "Close materials",
    available: "Available", empty: "Not recorded", untitled: "Untitled lesson", readOnly: "Read only", noPlan: "No saved lesson plan.", planBody: "Written lesson plan", attachments: "Attachments",
    noSolutions: "No saved solutions.", notes: "Solution notes", board: "Board solution", pageMissing: "The original page could not be loaded.", previewFailed: "Original pages could not be loaded. Retry to restore the comparison.",
    noVideo: "No rehearsal video link.", videoHint: "Opens the saved rehearsal link. The external service may require sign-in.", openVideo: "Open video", invalidVideo: "This saved link cannot be opened. Ask the teacher to update it.",
    open: "Open original", download: "Download", fileFailed: "File unavailable. Refresh to try again.", downloadFailed: "Download failed. Refresh and try again.", preview: "File preview", pdfHint: "If the PDF does not display, open or download the original.",
    updated: "Updated", revision: "Version", draft: "Draft", pending: "Awaiting review", approved: "Approved", changes_requested: "Changes requested", savedNotes: "Notes saved", videoLink: "Video link (select to copy)", previewUnavailable: "Preview unavailable. Open or download the original.", emptyPlan: "The saved lesson plan has no written content yet.",
  } : {
    title: "本课材料", lesson_plan: "教案", solution: "解析", rehearsal_video: "试讲视频", courseware: "课件",
    loading: "正在读取材料…", failed: "材料读取失败。", forbidden: "你暂时没有这些材料的查看权限。", retry: "重试", refresh: "刷新材料", close: "收起材料",
    available: "已有记录", empty: "暂无记录", untitled: "未命名课次", readOnly: "只读", noPlan: "暂无已保存教案。", planBody: "在线教案", attachments: "附件",
    noSolutions: "暂无已保存解析。", notes: "解析说明", board: "板书解析", pageMissing: "原课件页暂时无法读取。", previewFailed: "原课件页读取失败，可重试恢复对照。",
    noVideo: "暂无试讲视频链接。", videoHint: "打开老师保存的试讲链接，外部平台可能需要登录。", openVideo: "打开视频", invalidVideo: "保存的链接暂时无法打开，请老师更新链接。",
    open: "打开原件", download: "下载", fileFailed: "附件暂时无法读取，请刷新重试。", downloadFailed: "下载失败，请刷新后重试。", preview: "附件预览", pdfHint: "PDF 未显示时，可打开或下载原件。",
    updated: "更新于", revision: "版本", draft: "草稿", pending: "待审核", approved: "已通过", changes_requested: "待修改", savedNotes: "已有说明", videoLink: "视频链接（选中可复制）", previewUnavailable: "暂时无法预览，可打开或下载原件。", emptyPlan: "已保存的教案暂未填写正文。",
  };
}
