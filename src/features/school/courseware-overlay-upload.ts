import { createClient } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/sha256";

// 教师在覆盖层里插入的图片/视频页复用 P4 的 courseware 私有 bucket（路径首段 = classroom_id），
// 与候课/课堂预载走同一套 RLS（is_classroom_teacher 可写），不新增 bucket。

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

export function overlayAssetKind(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

export async function uploadOverlayAsset(classroomId: string, file: File): Promise<string> {
  if (!overlayAssetKind(file)) throw new Error("UNSUPPORTED_FILE");
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
