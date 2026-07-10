import { createClient } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/sha256";

// 模板媒体私有 bucket course-assets：路径首段 = course_id（RLS 依此判权限，写=admin）。
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

export function templateAssetKind(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

/** 返回 Storage 路径（存入 courseware_template jsonb 的 path 字段）。 */
export async function uploadTemplateAsset(courseId: string, file: File): Promise<string> {
  if (!templateAssetKind(file)) throw new Error("UNSUPPORTED_FILE");
  const hash = await sha256Hex(await file.arrayBuffer());
  const fallback = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const extension = EXTENSION_BY_MIME[file.type] ?? fallback ?? "bin";
  const path = `${courseId}/${hash}.${extension}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from("course-assets").upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });
  if (error && !/already exists|duplicate|resource exists/i.test(error.message)) throw error;
  return path;
}

/** 私有 bucket 下载（模板预览与候课预载共用路径规则）。 */
export async function downloadTemplateAsset(path: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from("course-assets").download(path);
  if (error) throw new Error(error.message);
  return data;
}
