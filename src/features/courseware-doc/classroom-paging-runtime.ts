import {
  CLASSROOM_PAGING_PROTOCOL,
  CLASSROOM_PAGING_RUNTIME_PARAM,
  CLASSROOM_PAGING_RUNTIME_VERSION,
} from "@/features/classroom/live/classroom-paging";
import { CLASSROOM_VIEWPORT_RUNTIME_PARAM, CLASSROOM_VIEWPORT_RUNTIME_VERSION } from "@/features/classroom/live/classroom-viewport";

/** Opaque iframe 只转发允许的按键；由父窗口显式启用并校验当前 iframe 和 token。 */
export const CLASSROOM_PAGING_RUNTIME = `<script data-mathin-classroom-paging="${CLASSROOM_PAGING_RUNTIME_VERSION}">
(() => {
  const protocol = "${CLASSROOM_PAGING_PROTOCOL}";
  if (window.__mathinClassroomPaging === protocol) return;
  window.__mathinClassroomPaging = protocol;
  let enabled = false;
  let token = "";
  const frames = () => Array.from(document.querySelectorAll("iframe"));
  const configure = (frame) => frame.contentWindow?.postMessage({ protocol, type: "configure", enabled, token }, "*");
  const direction = (key) => ["ArrowLeft", "ArrowRight", "PageUp", "PageDown", " "].includes(key);
  const dialogOpen = () => Array.from(document.querySelectorAll("dialog[open], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']"))
    .some((element) => element.getClientRects().length > 0);
  window.addEventListener("keydown", (event) => {
    if (!enabled || !direction(event.key) || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || dialogOpen()) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [role='textbox'], [role='combobox'], [role='spinbutton'], [contenteditable]:not([contenteditable='false'])")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    parent.postMessage({ protocol, type: "key", token, key: event.key }, "*");
  }, true);
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.protocol !== protocol) return;
    if (event.source === parent && data.type === "configure" && typeof data.token === "string" && data.token.length <= 128) {
      enabled = data.enabled === true;
      token = data.token;
      versionChildren();
      frames().forEach(configure);
      return;
    }
    const child = frames().find((frame) => frame.contentWindow === event.source);
    if (!child) return;
    if (data.type === "hello") { configure(child); return; }
    if (enabled && data.type === "key" && data.token === token && direction(data.key) && document.activeElement === child && !dialogOpen()) {
      parent.postMessage({ protocol, type: "key", token, key: data.key }, "*");
    }
  });
  const versionChildren = () => { if (!enabled) return; frames().forEach((frame) => {
    const src = frame.getAttribute("src");
    if (!src) return;
    try {
      const base = new URL(document.baseURI);
      const url = new URL(src, base);
      if (url.origin !== base.origin || !url.pathname.startsWith("/api/cw-h5/")) return;
      if (url.searchParams.get("${CLASSROOM_PAGING_RUNTIME_PARAM}") === "${CLASSROOM_PAGING_RUNTIME_VERSION}" && url.searchParams.get("${CLASSROOM_VIEWPORT_RUNTIME_PARAM}") === "${CLASSROOM_VIEWPORT_RUNTIME_VERSION}") return;
      url.searchParams.set("${CLASSROOM_PAGING_RUNTIME_PARAM}", "${CLASSROOM_PAGING_RUNTIME_VERSION}");
      url.searchParams.set("${CLASSROOM_VIEWPORT_RUNTIME_PARAM}", "${CLASSROOM_VIEWPORT_RUNTIME_VERSION}");
      frame.setAttribute("src", url.href);
    } catch { /* 非应用管理的 iframe 保留自身导航。 */ }
  }); };
  new MutationObserver(versionChildren).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  document.addEventListener("load", (event) => { if (event.target instanceof HTMLIFrameElement) configure(event.target); }, true);
  versionChildren();
  parent.postMessage({ protocol, type: "hello" }, "*");
})();
</script>`;
