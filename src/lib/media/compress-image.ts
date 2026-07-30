const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.82;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Best-effort client compression for photographed paper homework; unsupported formats keep the original file. */
export async function compressHomeworkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await canvasBlob(canvas, "image/jpeg", JPEG_QUALITY);
    if (!blob || blob.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "").slice(0, 160) || "homework";
    return new File([blob], baseName + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}