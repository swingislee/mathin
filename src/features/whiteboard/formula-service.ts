import { sanitizeLatex } from "./geometry";

const DEVELOPMENT_FORMULA_OCR_URL = "http://127.0.0.1:8503/pix2text";

export type FormulaOcrUrlResolution =
  | { ok: true; url: URL }
  | { ok: false; reason: "MISSING" | "INVALID" | "NON_LOOPBACK" };

/**
 * Production Mathin and Pix2Text run on the same Xiaomi host. Keeping this
 * boundary explicit prevents a missing environment variable from silently
 * routing production recognition back to a developer machine or arbitrary URL.
 */
export function resolveFormulaOcrUrl(
  configuredValue: string | undefined,
  environment: string | undefined,
): FormulaOcrUrlResolution {
  const configured = configuredValue?.trim();
  const rawUrl = configured || (environment === "production" ? "" : DEVELOPMENT_FORMULA_OCR_URL);
  if (!rawUrl) return { ok: false, reason: "MISSING" };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "INVALID" };
  }
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname.replace(/\/+$/, "") !== "/pix2text"
  ) {
    return { ok: false, reason: "INVALID" };
  }
  if (
    environment === "production"
    && (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    return { ok: false, reason: "NON_LOOPBACK" };
  }
  return { ok: true, url };
}

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
