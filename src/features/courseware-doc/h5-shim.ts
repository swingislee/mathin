/**
 * H5 垫片纯逻辑（docs/plan/16 §3 D3）。
 *
 * 背景:storage-api 有意把 text/html 降级为 text/plain(自托管无开关),
 * 故 H5 包的 HTML 由 mathin Route Handler 直出,其余子资源 308 回 storage
 * 公开桶。路径内容寻址(packages/<sha256>/...),响应可永久缓存。
 */

const PACKAGE_HASH = /^[0-9a-f]{64}$/;
const HTML_EXTENSIONS = new Set(["html", "htm"]);

export const H5_IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/**
 * Storage API rejects some raw Unicode object keys. H5 documents retain their
 * original relative filenames, while Storage uses this ASCII-safe projection.
 * Keep it segment based: slashes remain directory delimiters and a browser's
 * relative URL continues to resolve through the shim with the original name.
 */
function h5StorageSegment(segment: string): string {
  return /[^\x20-\x7E]/.test(segment) ? `u_${encodeURIComponent(segment).replaceAll("%", "_")}` : segment;
}

export function h5StorageObjectPath(objectPath: string): string {
  return objectPath.split("/").map(h5StorageSegment).join("/");
}

/**
 * 校验 catch-all 段并拼回桶内对象路径。
 * 只接受 packages/<packageHash>/<包内相对路径>;任何 ".."、空段、反斜杠、
 * 非法 hash 一律拒绝(返回 null → 404),防目录穿越与任意对象探测。
 */
export function h5ObjectPath(segments: readonly string[]): string | null {
  if (segments.length < 3 || segments[0] !== "packages") return null;
  if (!PACKAGE_HASH.test(segments[1])) return null;
  for (const segment of segments.slice(1)) {
    if (segment.length === 0 || segment === "." || segment === "..") return null;
    if (segment.includes("/") || segment.includes("\\")) return null;
  }
  return segments.join("/");
}

export function isHtmlObjectPath(objectPath: string): boolean {
  const dot = objectPath.lastIndexOf(".");
  if (dot < 0) return false;
  return HTML_EXTENSIONS.has(objectPath.slice(dot + 1).toLowerCase());
}

export function h5PublicUrl(supabaseUrl: string, objectPath: string): string {
  // The URL encodes the ASCII-safe physical Storage key, not the logical H5 filename.
  const encoded = h5StorageObjectPath(objectPath).split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/cw-h5/${encoded}`;
}

/**
 * 在 <head> 首部注入脚本片段的预案钩子(doc 16 §9:opaque origin 下
 * localStorage 抛 SecurityError,若代表性引擎实测破损,由垫片注入内存版
 * storage polyfill)。默认不启用;找不到 <head> 时前置到文档最前。
 */
export function injectHeadSnippet(html: string, snippet: string): string {
  const match = /<head[^>]*>/i.exec(html);
  if (!match) return snippet + html;
  const insertAt = match.index + match[0].length;
  return html.slice(0, insertAt) + snippet + html.slice(insertAt);
}
