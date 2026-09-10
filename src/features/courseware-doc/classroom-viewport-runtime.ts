import { CLASSROOM_VIEWPORT_PROTOCOL, CLASSROOM_VIEWPORT_RUNTIME_PARAM, CLASSROOM_VIEWPORT_RUNTIME_VERSION } from "@/features/classroom/live/classroom-viewport";

/** 只转发触点到当前父窗口；触控接管取消原手势，H5 自身业务协议保持原样。 */
export const CLASSROOM_VIEWPORT_RUNTIME = `<script data-mathin-classroom-viewport="${CLASSROOM_VIEWPORT_RUNTIME_VERSION}">
(() => {
  const protocol = "${CLASSROOM_VIEWPORT_PROTOCOL}";
  if (window.__mathinClassroomViewport === protocol) return;
  window.__mathinClassroomViewport = protocol;
  let enabled = false, token = "", reserved = false, cancelling = false, suppressUntil = 0;
  let viewportEnabled = true, palmThreshold = 0, scaleX = 1, scaleY = 1;
  let previousAction = "";
  const points = new Map(), children = new Map();
  const pens = new Set();
  let nextChildId = 100000;
  const frames = () => Array.from(document.querySelectorAll("iframe"));
  const send = (data) => parent.postMessage({ protocol, token, ...data }, "*");
  const configure = (frame) => {
    const rect = frame.getBoundingClientRect();
    frame.contentWindow?.postMessage({ protocol, type: "configure", enabled, token, viewport: viewportEnabled, palmThreshold,
      scaleX: scaleX * rect.width / Math.max(1, frame.clientWidth || rect.width),
      scaleY: scaleY * rect.height / Math.max(1, frame.clientHeight || rect.height) }, "*");
  };
  const reserve = (active) => {
    const starting = active && !reserved;
    reserved = active;
    if (starting) {
      cancelling = true;
      for (const [id, point] of points) {
        point.target?.dispatchEvent(new PointerEvent("pointercancel", { pointerId: id, pointerType: "touch", bubbles: true }));
        try { point.target?.setPointerCapture?.(id); } catch {}
      }
      cancelling = false;
    } else if (!active) suppressUntil = performance.now() + 600;
    frames().forEach((frame) => frame.contentWindow?.postMessage({ protocol, type: "reserve", active, token }, "*"));
  };
  const point = (event, phase) => ({ type: "touch", phase, id: event.pointerId, x: event.screenX, y: event.screenY,
    nx: Math.max(0, Math.min(1, event.clientX / Math.max(1, innerWidth))),
    ny: Math.max(0, Math.min(1, event.clientY / Math.max(1, innerHeight))),
    nw: Math.max(0, Math.min(1, (Number.isFinite(event.width) ? event.width : 0) / Math.max(1, innerWidth))),
    nh: Math.max(0, Math.min(1, (Number.isFinite(event.height) ? event.height : 0) / Math.max(1, innerHeight))) });
  const palm = (event) => palmThreshold > 2 && event.width > 1 && event.height > 1 && event.width <= 1024 && event.height <= 1024
    && Math.sqrt(event.width * scaleX * event.height * scaleY) >= palmThreshold;
  const pointer = (event) => {
    if (!enabled || cancelling) return;
    const phase = { pointerdown: "down", pointermove: "move", pointerup: "up", pointercancel: "cancel" }[event.type];
    if (event.pointerType === "pen") {
      if (phase === "down") { pens.add(event.pointerId); send({ type: "pen", phase, id: event.pointerId }); }
      else if (pens.has(event.pointerId) && (phase === "up" || phase === "cancel")) { pens.delete(event.pointerId); send({ type: "pen", phase, id: event.pointerId }); }
      return;
    }
    if (event.pointerType !== "touch") return;
    if (phase === "down") {
      if (points.size >= 10) return;
      points.set(event.pointerId, { target: event.target, data: point(event, phase) });
    } else if (!points.has(event.pointerId)) return;
    if (!reserved && (phase === "down" || phase === "move") && (palm(event) || (viewportEnabled && points.size > 1))) reserve(true);
    const data = point(event, phase);
    if (points.has(event.pointerId)) points.get(event.pointerId).data = data;
    send(data);
    const owned = reserved;
    if (phase === "up" || phase === "cancel") points.delete(event.pointerId);
    if (owned) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  ["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach((name) => window.addEventListener(name, pointer, { capture: true, passive: false }));
  window.addEventListener("click", (event) => {
    if (enabled && (reserved || performance.now() < suppressUntil)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  const cancel = () => {
    for (const point of points.values()) send({ ...point.data, phase: "cancel" });
    points.clear(); reserve(false);
    for (const id of pens) send({ type: "pen", phase: "cancel", id });
    pens.clear();
  };
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  window.addEventListener("pagehide", cancel);
  const versionChildren = () => { if (!enabled) return; frames().forEach((frame) => {
    const src = frame.getAttribute("src");
    if (!src) return;
    try {
      const base = new URL(document.baseURI), url = new URL(src, base);
      if (url.origin !== base.origin || !url.pathname.startsWith("/api/cw-h5/") || url.searchParams.get("${CLASSROOM_VIEWPORT_RUNTIME_PARAM}") === "${CLASSROOM_VIEWPORT_RUNTIME_VERSION}") return;
      url.searchParams.set("${CLASSROOM_VIEWPORT_RUNTIME_PARAM}", "${CLASSROOM_VIEWPORT_RUNTIME_VERSION}");
      frame.setAttribute("src", url.href);
    } catch {}
  }); };
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.protocol !== protocol) return;
    if (event.source === parent) {
      if (data.type === "configure" && typeof data.token === "string" && data.token.length > 0 && data.token.length <= 128) {
        if (data.token !== token || data.enabled !== true) cancel();
        if (data.enabled === true && !enabled) { previousAction = document.documentElement.style.touchAction; document.documentElement.style.touchAction = "none"; }
        if (data.enabled !== true && enabled) document.documentElement.style.touchAction = previousAction;
        token = data.token; enabled = data.enabled === true;
        viewportEnabled = data.viewport !== false;
        palmThreshold = Number.isFinite(data.palmThreshold) && data.palmThreshold > 2 && data.palmThreshold <= 1024 ? data.palmThreshold : 0;
        scaleX = Number.isFinite(data.scaleX) && data.scaleX > 0 && data.scaleX <= 100 ? data.scaleX : 1;
        scaleY = Number.isFinite(data.scaleY) && data.scaleY > 0 && data.scaleY <= 100 ? data.scaleY : 1;
        versionChildren(); frames().forEach(configure);
      } else if (data.type === "reserve" && data.token === token && enabled) reserve(data.active === true);
      return;
    }
    const child = frames().find((frame) => frame.contentWindow === event.source);
    if (!child) return;
    if (data.type === "hello") { configure(child); return; }
    if (data.type === "cancel-all" && data.token === token) { send({ type: "cancel-all" }); children.clear(); return; }
    if (!enabled || data.token !== token || !["touch", "pen"].includes(data.type) || !Number.isSafeInteger(data.id)
      || !["down", "move", "up", "cancel"].includes(data.phase)) return;
    if (data.type === "touch" && (![data.x, data.y, data.ny].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6)
      || data.ny < 0 || data.ny > 1 || [data.nx, data.nw, data.nh].some((n) => n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1)))) return;
    if (!children.has(child)) children.set(child, new Map());
    const ids = children.get(child);
    if (data.phase === "down" && ids.size < 10) ids.set(data.id, ++nextChildId);
    const id = ids.get(data.id);
    if (!id) return;
    if (data.type === "pen") send({ type: "pen", phase: data.phase, id });
    else {
      const rect = child.getBoundingClientRect();
      send({ type: "touch", phase: data.phase, id, x: data.x, y: data.y,
        nx: Math.max(0, Math.min(1, (rect.left + (data.nx ?? 0.5) * rect.width) / Math.max(1, innerWidth))),
        ny: Math.max(0, Math.min(1, (rect.top + data.ny * rect.height) / Math.max(1, innerHeight))),
        nw: Math.max(0, Math.min(1, (data.nw ?? 0) * rect.width / Math.max(1, innerWidth))),
        nh: Math.max(0, Math.min(1, (data.nh ?? 0) * rect.height / Math.max(1, innerHeight))) });
    }
    if (data.phase === "up" || data.phase === "cancel") ids.delete(data.id);
  });
  new MutationObserver(() => { versionChildren(); for (const frame of children.keys()) if (!document.contains(frame)) { children.delete(frame); send({ type: "cancel-all" }); } }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  document.addEventListener("load", (event) => { if (event.target instanceof HTMLIFrameElement) { children.delete(event.target); send({ type: "cancel-all" }); configure(event.target); } }, true);
  send({ type: "hello" });
})();
</script>`;
