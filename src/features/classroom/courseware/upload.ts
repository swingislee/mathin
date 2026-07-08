import { createClient } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/sha256";

// 课件直传私有 bucket courseware：路径首段 = classroom_id（RLS 依此判成员/教师）。
// 内容寻址（hash 文件名）天然去重，重复上传同一文件秒完成。

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export function coursewareKind(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

/** 返回 Storage 路径（存入 courseware jsonb 的 path 字段）。 */
export async function uploadCoursewareAsset(classroomId: string, file: File): Promise<string> {
  if (!coursewareKind(file)) throw new Error("UNSUPPORTED_FILE");
  const hash = await sha256Hex(await file.arrayBuffer());
  const fallback = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const extension = EXTENSION_BY_MIME[file.type] ?? fallback ?? "bin";
  const path = `${classroomId}/${hash}.${extension}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from("courseware").upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });
  if (error && !/already exists|duplicate|resource exists/i.test(error.message)) throw error;
  return path;
}

/** 私有 bucket 下载（候课预载与课件编辑预览共用）。 */
export async function downloadCoursewareAsset(path: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from("courseware").download(path);
  if (error) throw new Error(error.message);
  return data;
}
