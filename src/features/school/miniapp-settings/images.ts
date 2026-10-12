import "server-only";
import sharp from "sharp";

export const MINIAPP_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Decode before storing, strip metadata and constrain both decoded pixels and transfer size. */
export async function prepareMiniappImage(file: File) {
  if (!file.size || file.size > MINIAPP_UPLOAD_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("VALIDATION");
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const source = sharp(bytes, { limitInputPixels: 32_000_000, animated: false, failOn: "warning" }).rotate();
    const meta = await source.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages || 1) > 1) throw new Error("VALIDATION");
    const [display, thumbnail] = await Promise.all([
      source.clone().resize({ width: 1600, height: 5000, fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 4 }).toBuffer(),
      source.clone().resize({ width: 480, height: 960, fit: "inside", withoutEnlargement: true }).webp({ quality: 76, effort: 4 }).toBuffer(),
    ]);
    if (display.length > 2 * 1024 * 1024 || thumbnail.length > 512 * 1024) throw new Error("VALIDATION");
    return { display, thumbnail };
  } catch { throw new Error("VALIDATION"); }
}
