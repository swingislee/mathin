import { z } from "zod";
import { materialFileBelongsToSession, materialFileSchema } from "./session-materials-contract";

export const MATERIAL_SUPPLEMENT_KINDS = ["solution", "lesson_plan", "rehearsal_video"] as const;
export type MaterialSupplementKind = typeof MATERIAL_SUPPLEMENT_KINDS[number];
export const MATERIAL_SUPPLEMENT_MAX_BYTES = 12 * 1024 * 1024;
export const materialSupplementSchema = z.object({
  sessionId: z.uuid(), kind: z.enum(MATERIAL_SUPPLEMENT_KINDS),
  files: z.array(materialFileSchema.extend({ name: z.string().trim().min(1).max(200),
    path: z.string().max(500), type: z.string().max(200), size: z.number().int().nonnegative().max(MATERIAL_SUPPLEMENT_MAX_BYTES) })).max(10),
  notes: z.string().trim().max(5000),
  videoUrl: z.string().trim().max(1000),
}).strict().superRefine((value, ctx) => {
  const invalid = () => ctx.addIssue({ code: "custom", message: "VALIDATION" });
  if (value.kind === "rehearsal_video") {
    try { const url = new URL(value.videoUrl); if (url.protocol !== "https:" || url.username || url.password) invalid(); }
    catch { invalid(); }
    if (value.files.length || value.notes) invalid();
  } else {
    if (value.videoUrl || value.kind === "lesson_plan" && value.notes) invalid();
    if (!value.files.length && !(value.kind === "solution" && value.notes)) invalid();
    if (value.files.some(file => !materialFileBelongsToSession(file.path, value.sessionId, value.kind as "solution" | "lesson_plan"))) invalid();
  }
});
export type MaterialSupplementInput = z.infer<typeof materialSupplementSchema>;
export const materialSupplementResultSchema = z.object({ revision: z.number().int().nonnegative(), submittedAt: z.string().nullable(), changed: z.boolean() });
export type MaterialSupplementResult = z.infer<typeof materialSupplementResultSchema>;

/** 补交 RPC 的局部签名，与对应 migration 一起维护。 */
export interface MaterialSupplementRpc {
  (name: "can_supplement_session_materials", args: { p_session_id: string }): PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
  (name: "supplement_session_preparation_artifact", args: {
    p_session_id: string; p_kind: MaterialSupplementKind; p_files: MaterialSupplementInput["files"]; p_notes: string; p_video_url: string;
  }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function materialSupplementMessages(locale: string) {
  return locale.startsWith("en") ? {
    open: "Submit for teacher", title: "Submit lesson materials for the teacher", close: "Close submission", kind: "Material", files: "Add attachments", notes: "Additional solution notes", video: "Rehearsal video URL",
    hint: "Adds to this lesson's materials and records your account as the submitter. New material awaits review.",
    fileHint: "Images, PDF or Word files; up to 12 MB each and 10 attachments in total for this material.",
    submit: "Submit for review", submitting: "Submitting…", remove: "Remove selected file", success: "Submitted for review.", unchanged: "This material has already been submitted.",
    discard: "Discard the unsubmitted materials?", failed: "Submission failed. Your selection is retained; try again.",
    forbidden: "You cannot submit materials for this lesson.", conflict: "This lesson already contains different material at that location. Refresh the materials and use the existing editing workflow to revise it.",
    filesLimit: "The material would exceed 10 attachments. Refresh and check the existing files.", fileSize: "Select files no larger than 12 MB each.", notesLimit: "The combined solution notes exceed 5,000 characters.",
    reviewer: "Assign an active teacher to this lesson before submitting.", invalid: "Add an attachment, solution notes, or a valid HTTPS video URL.",
  } : {
    open: "代老师补交", title: "代老师补交本课资料", close: "收起补交", kind: "资料类型", files: "添加附件", notes: "补充解析说明", video: "练课视频链接",
    hint: "资料归入当前课次，记录你的账号为提交人，新增内容进入待审核。",
    fileHint: "支持图片、PDF、Word；每个文件不超过 12 MB，本类附件合计最多 10 个。",
    submit: "补交并送审", submitting: "正在提交…", remove: "移除待交文件", success: "已补交，等待审核。", unchanged: "这份资料已提交。",
    discard: "放弃尚未提交的资料？", failed: "补交失败，已保留当前选择，请重试。",
    forbidden: "你暂时没有这个课次的补交权限。", conflict: "本课已有不同资料，请刷新核对；需要修订时使用原资料编辑入口。",
    filesLimit: "本类附件合计将超过 10 个，请刷新核对已有附件。", fileSize: "请选择单个不超过 12 MB 的文件。", notesLimit: "合并后的解析说明超过 5,000 字，请缩短补充内容。",
    reviewer: "请先为该课次安排有效任课老师，再补交资料。", invalid: "请添加附件、解析说明或有效的 HTTPS 视频链接。",
  };
}
