import { sanitizeLatex } from "./geometry";

/** Pix2Text 对 formula 返回字符串，对 page/text_formula 返回带 text 的结果数组。 */
export function extractPix2TextLatex(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const results = (payload as { results?: unknown }).results;
  if (typeof results === "string") return sanitizeLatex(results);
  if (!Array.isArray(results)) return "";
  const text = results
    .map((entry) => entry && typeof entry === "object" ? (entry as { text?: unknown }).text : null)
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return sanitizeLatex(text);
}
