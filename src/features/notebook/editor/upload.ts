import { createClient } from "@/lib/supabase/client";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createNoteUpload(userId: string, noteId: string) {
  return async (file: File) => {
    if (!file.type.startsWith("image/")) throw new Error("UNSUPPORTED_FILE");
    const hash = toHex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
    const fallback = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const extension = EXTENSION_BY_MIME[file.type] ?? fallback ?? "bin";
    const path = `${userId}/${noteId}/${hash}.${extension}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from("note-assets").upload(path, file, {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    });
    if (error && !/already exists|duplicate|resource exists/i.test(error.message)) throw error;
    return supabase.storage.from("note-assets").getPublicUrl(path).data.publicUrl;
  };
}
