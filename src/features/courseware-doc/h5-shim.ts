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
export const H5_SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-pointer-lock allow-modals";

export function h5HtmlSecurityHeaders(requestUrl: string): Record<string, string> {
  const entrypoint = new URL(requestUrl).searchParams.get("mathin_h5_runtime") === "2";
  return {
    "Content-Security-Policy": H5_SANDBOX_CSP,
    ...(entrypoint ? { "X-Frame-Options": "SAMEORIGIN" } : {}),
  };
}

/**
 * Runtime injected before package scripts. Opaque-origin sandbox documents throw
 * on localStorage/sessionStorage access; several legacy courseware video managers
 * read storage during bootstrap and otherwise stop before binding their controls.
 * The same bridge relays native media events through nested package iframes.
 */
export const H5_OPAQUE_ORIGIN_RUNTIME = `<script data-mathin-h5-runtime>
(() => {
  if (window.__mathinH5Runtime) return;
  window.__mathinH5Runtime = true;

  const createMemoryStorage = () => {
    const values = new Map();
    return {
      get length() { return values.size; },
      key(index) { return Array.from(values.keys())[index] ?? null; },
      getItem(key) { key = String(key); return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(String(key), String(value)); },
      removeItem(key) { values.delete(String(key)); },
      clear() { values.clear(); },
    };
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      void window[name];
    } catch {
      Object.defineProperty(window, name, { configurable: true, value: createMemoryStorage() });
    }
  }

  let applying = 0;
  const media = () => Array.from(document.querySelectorAll("video,audio"));
  const childFrames = () => Array.from(document.querySelectorAll("iframe"));
  const relay = (event) => {
    if (applying > 0) return;
    const target = event.target;
    if (!(target instanceof HTMLMediaElement)) return;
    const action = event.type === "play" ? "play" : event.type === "pause" ? "pause" : "seek";
    parent.postMessage({ source: "mathin-h5-media", action, time: target.currentTime || 0 }, "*");
  };
  document.addEventListener("play", relay, true);
  document.addEventListener("pause", relay, true);
  document.addEventListener("seeked", relay, true);

  const applyControl = (data) => {
    applying += 1;
    for (const target of media()) {
      if (Number.isFinite(data.time)) {
        try { target.currentTime = data.time; } catch {}
      }
      if (data.action === "play") {
        Promise.resolve(target.play()).catch(() => {
          target.muted = true;
          return target.play();
        }).catch(() => {});
      } else if (data.action === "pause") {
        target.pause();
      }
    }
    for (const frame of childFrames()) {
      frame.contentWindow?.postMessage(data, "*");
    }
    setTimeout(() => { applying = Math.max(0, applying - 1); }, 120);
  };

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.source === "mathin-h5-media") {
      if (event.source !== parent) parent.postMessage(data, "*");
      return;
    }
    if (data.source === "mathin-classroom" && data.type === "media_ctl") applyControl(data);
  });
})();
</script>`;

/**
 * Storage API rejects some raw Unicode object keys. H5 documents retain their
 * original relative filenames, while Storage uses this ASCII-safe projection.
 * Keep it segment based: slashes remain directory delimiters and a browser's
 * relative URL continues to resolve through the shim with the original name.
 */
function h5StorageSegment(segment: string): string {
  let logical = segment;
  try {
    logical = decodeURIComponent(segment);
  } catch {
    // 非法百分号序列按原逻辑名继续投影，不能让请求逃出内容寻址包。
  }
  return /[^\x20-\x7E]|[:%]/.test(logical)
    ? `u_${encodeURIComponent(logical).replaceAll("%", "_")}`
    : logical;
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

export function injectH5Runtime(html: string): string {
  return injectHeadSnippet(html, H5_OPAQUE_ORIGIN_RUNTIME);
}
