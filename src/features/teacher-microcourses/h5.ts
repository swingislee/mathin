import { MICROCOURSE_H5_MAX_BYTES } from "@/features/courseware-doc/microcourse-schema";

/** Hashing and preview always use the same LF-normalized UTF-8 bytes. */
export function normalizeMicrocourseH5(html: string): string {
  return html.replace(/\r\n?/g, "\n");
}

export function microcourseH5Bytes(html: string): Uint8Array {
  const bytes = new TextEncoder().encode(normalizeMicrocourseH5(html));
  if (bytes.byteLength > MICROCOURSE_H5_MAX_BYTES) {
    throw new Error("H5_TOO_LARGE");
  }
  return bytes;
}

export function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FILE_READ_FAILED"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

