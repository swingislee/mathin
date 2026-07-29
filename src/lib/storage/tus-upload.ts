import { createClient } from "@/lib/supabase/client";
import { getSupabaseConfig } from "@/lib/supabase/config";

const TUS_VERSION = "1.0.0";
const DEFAULT_CHUNK_SIZE = 6 * 1024 * 1024;

export interface TusUploadOptions {
  bucketId: string;
  objectPath: string;
  file: File;
  expectedSha256?: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
  signal?: AbortSignal;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}

function metadataValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function uploadMetadata(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key} ${metadataValue(value)}`).join(",");
}

async function errorText(response: Response): Promise<string> {
  return (await response.text()) || `${response.status} ${response.statusText}`;
}

async function retry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function uploadTusFile(options: TusUploadOptions): Promise<{ uploadSessionId: string; verifyJobId: string }> {
  const supabase = createClient();
  const { url, key } = getSupabaseConfig();
  const { data: authData, error: authError } = await supabase.auth.getSession();
  const accessToken = authData.session?.access_token;
  if (authError || !accessToken) throw new Error("UNAUTHENTICATED");

  const { data: sessions, error: sessionError } = await supabase.rpc("begin_file_upload_session", {
    p_bucket_id: options.bucketId,
    p_object_path: options.objectPath,
    p_expected_size: options.file.size,
    p_mime_type: options.file.type,
    p_expected_sha256: options.expectedSha256,
    p_linked_entity_type: options.linkedEntityType,
    p_linked_entity_id: options.linkedEntityId,
  });
  if (sessionError || !sessions?.[0]) throw new Error(sessionError?.message || "UPLOAD_SESSION_FAILED");
  const uploadSessionId = sessions[0].session_id;
  const chunkSize = sessions[0].chunk_size || DEFAULT_CHUNK_SIZE;
  const storageKey = `mathin.tus.${uploadSessionId}`;
  const endpoint = `${url.replace(/\/$/, "")}/storage/v1/upload/resumable`;
  const headers = { apikey: key, authorization: `Bearer ${accessToken}`, "tus-resumable": TUS_VERSION };
  let uploadUrl = sessionStorage.getItem(storageKey);
  let offset = 0;

  if (uploadUrl) {
    const head = await fetch(uploadUrl, { method: "HEAD", headers, signal: options.signal });
    if (head.ok) offset = Number(head.headers.get("upload-offset") || 0);
    else {
      sessionStorage.removeItem(storageKey);
      uploadUrl = null;
    }
  }

  if (!uploadUrl) {
    const create = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "upload-length": String(options.file.size),
        "upload-metadata": uploadMetadata({
          bucketName: options.bucketId,
          objectName: options.objectPath,
          contentType: options.file.type,
          cacheControl: "31536000",
        }),
        "x-upsert": "false",
      },
      signal: options.signal,
    });
    if (!create.ok) throw new Error(`TUS_CREATE:${await errorText(create)}`);
    const location = create.headers.get("location");
    if (!location) throw new Error("TUS_LOCATION_MISSING");
    uploadUrl = new URL(location, endpoint).toString();
    sessionStorage.setItem(storageKey, uploadUrl);
  }

  options.onProgress?.(offset, options.file.size);
  while (offset < options.file.size) {
    const next = Math.min(options.file.size, offset + chunkSize);
    const chunk = options.file.slice(offset, next);
    const patch = await retry(async () => {
      const response = await fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          ...headers,
          "upload-offset": String(offset),
          "content-type": "application/offset+octet-stream",
        },
        body: chunk,
        signal: options.signal,
      });
      if (!response.ok) throw new Error(`TUS_PATCH:${await errorText(response)}`);
      return response;
    });
    const reportedOffset = Number(patch.headers.get("upload-offset"));
    if (reportedOffset !== next) throw new Error("TUS_OFFSET_MISMATCH");
    offset = reportedOffset;
    const { error: advanceError } = await supabase.rpc("advance_file_upload_session", {
      p_session_id: uploadSessionId,
      p_offset: offset,
    });
    if (advanceError) throw new Error(advanceError.message);
    options.onProgress?.(offset, options.file.size);
  }

  const { data: verifyJobId, error: finishError } = await supabase.rpc("finish_file_upload_session", {
    p_session_id: uploadSessionId,
  });
  if (finishError || !verifyJobId) throw new Error(finishError?.message || "UPLOAD_FINISH_FAILED");
  sessionStorage.removeItem(storageKey);
  return { uploadSessionId, verifyJobId };
}
