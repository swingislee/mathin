/**
 * H5 垫片纯逻辑（docs/plan/16 §3 D3）。
 *
 * 背景:storage-api 有意把 text/html 降级为 text/plain(自托管无开关),
 * 故 H5 包的 HTML 由 mathin Route Handler 直出,其余子资源 308 回 storage
 * 公开桶。路径内容寻址(packages/<sha256>/...),响应可永久缓存。
 */

import {
  H5_POINTER_FRAME_SOURCE,
  H5_POINTER_MAX_POINTS_PER_CHUNK,
  H5_POINTER_PARENT_SOURCE,
  H5_POINTER_PROTOCOL_SCHEMA,
  H5_POINTER_PROTOCOL_VERSION,
  H5_POINTER_RUNTIME_VERSION,
} from "./h5-pointer-protocol";
import type { H5InputProfile } from "./h5-input-profile";

const PACKAGE_HASH = /^[0-9a-f]{64}$/;
const HTML_EXTENSIONS = new Set(["html", "htm"]);

export const H5_IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const H5_SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-pointer-lock allow-modals";

export function h5HtmlSecurityHeaders(requestUrl: string): Record<string, string> {
  const entrypoint = new URL(requestUrl).searchParams.get("mathin_h5_runtime") === H5_POINTER_RUNTIME_VERSION;
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
export const H5_OPAQUE_ORIGIN_RUNTIME = `<script data-mathin-h5-runtime="${H5_POINTER_RUNTIME_VERSION}">
(() => {
  if (window.__mathinH5Runtime) return;
  window.__mathinH5Runtime = "${H5_POINTER_RUNTIME_VERSION}";

  const POINTER_SCHEMA = "${H5_POINTER_PROTOCOL_SCHEMA}";
  const POINTER_VERSION = ${H5_POINTER_PROTOCOL_VERSION};
  const POINTER_FRAME_SOURCE = "${H5_POINTER_FRAME_SOURCE}";
  const POINTER_PARENT_SOURCE = "${H5_POINTER_PARENT_SOURCE}";
  const MAX_POINTS = ${H5_POINTER_MAX_POINTS_PER_CHUNK};
  const INPUT_PROVIDER_SCHEMA = "mathin-classroom-input";
  const INPUT_PROVIDER_VERSION = 1;

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
  const childFrameForSource = (source) => childFrames().find((frame) => frame.contentWindow === source) || null;
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

  const capabilities = ["click", "drag", "native", "ink", "unknown"];
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const rootProvider = () => {
    const root = document.documentElement;
    const providerSchema = root.getAttribute("data-classroom-input-provider") || "unsupported";
    const providerVersion = Number(root.getAttribute("data-classroom-renderer-version") || 0);
    const defaultCapability = root.getAttribute("data-classroom-input-default") || "unknown";
    return {
      providerSchema,
      providerVersion,
      defaultCapability: capabilities.includes(defaultCapability) ? defaultCapability : "unknown",
      compatible: providerSchema === INPUT_PROVIDER_SCHEMA
        && providerVersion === INPUT_PROVIDER_VERSION
        && capabilities.includes(defaultCapability),
    };
  };
  const pointerEnvelope = (type, extra = {}) => ({
    source: POINTER_FRAME_SOURCE,
    schema: POINTER_SCHEMA,
    version: POINTER_VERSION,
    type,
    frameId: pointerSession?.frameId || "unbound",
    channelToken: pointerSession?.channelToken || "unbound",
    ...extra,
  });
  const postPointer = (type, extra = {}) => {
    if (!pointerSession) return;
    parent.postMessage(pointerEnvelope(type, extra), "*");
  };
  const isPointerParentMessage = (data) => Boolean(
    data
    && data.source === POINTER_PARENT_SOURCE
    && data.schema === POINTER_SCHEMA
    && data.version === POINTER_VERSION
    && typeof data.frameId === "string"
    && typeof data.channelToken === "string"
  );
  const isPointerFrameMessage = (data) => Boolean(
    data
    && data.source === POINTER_FRAME_SOURCE
    && data.schema === POINTER_SCHEMA
    && data.version === POINTER_VERSION
    && typeof data.frameId === "string"
    && typeof data.channelToken === "string"
  );
  const matchesPointerSession = (data) => Boolean(
    pointerSession
    && data.frameId === pointerSession.frameId
    && data.channelToken === pointerSession.channelToken
  );
  const parentPointerMessage = (type, extra = {}) => ({
    source: POINTER_PARENT_SOURCE,
    schema: POINTER_SCHEMA,
    version: POINTER_VERSION,
    type,
    frameId: pointerSession?.frameId || "unbound",
    channelToken: pointerSession?.channelToken || "unbound",
    ...extra,
  });
  const forwardToChildren = (data) => {
    for (const frame of childFrames()) frame.contentWindow?.postMessage(data, "*");
  };
  const normalizedPoint = (event) => ({
    x: clamp01(event.clientX / Math.max(window.innerWidth, 1)),
    y: clamp01(event.clientY / Math.max(window.innerHeight, 1)),
  });
  const remapChildPoint = (point, frame) => {
    const rect = frame.getBoundingClientRect();
    return {
      x: clamp01((rect.left + Number(point.x) * rect.width) / Math.max(window.innerWidth, 1)),
      y: clamp01((rect.top + Number(point.y) * rect.height) / Math.max(window.innerHeight, 1)),
    };
  };
  const safePoints = (value) => Array.isArray(value)
    && value.length <= MAX_POINTS
    && value.every((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  const relayChildPointer = (data, frame) => {
    if (!matchesPointerSession(data)) return;
    const relayDepth = Number(data.relayDepth || 0);
    if (!Number.isInteger(relayDepth) || relayDepth < 0 || relayDepth >= 8) return;
    if (data.type === "pointer_start") {
      if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
      const point = remapChildPoint({ x: data.x, y: data.y }, frame);
      parent.postMessage(pointerEnvelope("pointer_start", {
        pointerId: data.pointerId,
        pointerType: data.pointerType,
        gestureToken: data.gestureToken,
        capability: data.capability,
        isPrimary: data.isPrimary,
        button: data.button,
        ...point,
        relayDepth: relayDepth + 1,
      }), "*");
      return;
    }
    if (data.type === "pointer_move" || data.type === "pointer_end") {
      if (!safePoints(data.points)) return;
      parent.postMessage(pointerEnvelope(data.type, {
        pointerId: data.pointerId,
        gestureToken: data.gestureToken,
        chunkSeq: data.chunkSeq,
        points: data.points.map((point) => remapChildPoint(point, frame)),
        relayDepth: relayDepth + 1,
      }), "*");
      return;
    }
    if (data.type === "pointer_cancel") {
      parent.postMessage(pointerEnvelope("pointer_cancel", {
        pointerId: data.pointerId,
        gestureToken: data.gestureToken,
      }), "*");
    }
  };

  let pointerSession = null;
  let pointerReady = false;
  let pointerMode = "interaction-lock";
  let pointerSequence = 0;
  let activePointer = null;
  let suppressedClick = null;
  let moveFrame = 0;
  let previousPointerStyles = null;
  let childPointerStates = new Map();

  const reportRootCapabilities = (forceIncompatible = false) => {
    const provider = rootProvider();
    postPointer("pointer_capabilities", {
      providerSchema: forceIncompatible ? "unsupported-nested-frame" : provider.providerSchema,
      providerVersion: forceIncompatible ? 0 : provider.providerVersion,
      defaultCapability: forceIncompatible ? "unknown" : provider.defaultCapability,
    });
  };
  const allChildrenReady = () => {
    const frames = childFrames();
    const currentFrames = new Set(frames);
    for (const frame of childPointerStates.keys()) {
      if (!currentFrames.has(frame)) childPointerStates.delete(frame);
    }
    return frames.every((frame) => childPointerStates.get(frame) === "ready");
  };
  const startChildHandshake = () => {
    const frames = childFrames();
    childPointerStates = new Map(frames.map((frame) => [frame, "pending"]));
    const provider = rootProvider();
    if (!provider.compatible || frames.length === 0) reportRootCapabilities();
    forwardToChildren(parentPointerMessage("pointer_hello"));
  };

  const applyPointerMode = (mode) => {
    pointerMode = mode === "smart" ? "smart" : "interaction-lock";
    const root = document.documentElement;
    if (pointerMode === "smart") {
      if (!previousPointerStyles) {
        previousPointerStyles = {
          userSelect: root.style.userSelect,
          webkitUserSelect: root.style.webkitUserSelect,
          webkitTouchCallout: root.style.getPropertyValue("-webkit-touch-callout"),
        };
      }
      root.style.userSelect = "none";
      root.style.webkitUserSelect = "none";
      root.style.setProperty("-webkit-touch-callout", "none");
      return;
    }
    if (!previousPointerStyles) return;
    root.style.userSelect = previousPointerStyles.userSelect;
    root.style.webkitUserSelect = previousPointerStyles.webkitUserSelect;
    if (previousPointerStyles.webkitTouchCallout) {
      root.style.setProperty("-webkit-touch-callout", previousPointerStyles.webkitTouchCallout);
    } else {
      root.style.removeProperty("-webkit-touch-callout");
    }
    previousPointerStyles = null;
  };

  const targetCapability = (event) => {
    for (const target of event.composedPath()) {
      if (!(target instanceof Element) || !target.hasAttribute("data-classroom-input")) continue;
      const value = target.getAttribute("data-classroom-input") || "unknown";
      return capabilities.includes(value) ? { capability: value, owner: target } : { capability: "unknown", owner: target };
    }
    return { capability: rootProvider().defaultCapability, owner: event.target instanceof Element ? event.target : null };
  };
  const flushMoves = () => {
    moveFrame = 0;
    const active = activePointer;
    if (!active || active.points.length === 0) return;
    const points = active.points.splice(0, MAX_POINTS);
    active.chunkSeq += 1;
    postPointer("pointer_move", {
      pointerId: active.pointerId,
      gestureToken: active.gestureToken,
      chunkSeq: active.chunkSeq,
      points,
    });
    if (active.points.length > 0) moveFrame = requestAnimationFrame(flushMoves);
  };
  const flushAllMoves = () => {
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    const active = activePointer;
    if (!active) return;
    while (active.points.length > 0) {
      const points = active.points.splice(0, MAX_POINTS);
      active.chunkSeq += 1;
      postPointer("pointer_move", {
        pointerId: active.pointerId,
        gestureToken: active.gestureToken,
        chunkSeq: active.chunkSeq,
        points,
      });
    }
  };
  const scheduleMoves = () => {
    if (!moveFrame) moveFrame = requestAnimationFrame(flushMoves);
  };
  const clearActivePointer = () => {
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    if (activePointer?.target?.hasPointerCapture?.(activePointer.pointerId)) {
      try { activePointer.target.releasePointerCapture(activePointer.pointerId); } catch {}
    }
    activePointer = null;
  };
  const takeoverActivePointer = (gestureToken) => {
    if (!activePointer || activePointer.gestureToken !== gestureToken) return;
    activePointer.takeover = true;
    try { activePointer.target?.setPointerCapture?.(activePointer.pointerId); } catch {}
    window.getSelection?.()?.removeAllRanges();
  };
  const abortActivePointer = (gestureToken) => {
    if (!activePointer || activePointer.gestureToken !== gestureToken) return;
    clearActivePointer();
  };

  document.addEventListener("pointerdown", (event) => {
    if (!pointerReady || pointerMode !== "smart" || activePointer || !event.isPrimary || event.button !== 0) return;
    const target = targetCapability(event);
    if (target.capability !== "click" && target.capability !== "ink") return;
    pointerSequence += 1;
    const gestureToken = pointerSession.frameId + ":" + pointerSequence + ":" + event.pointerId;
    activePointer = {
      pointerId: event.pointerId,
      gestureToken,
      target: target.owner,
      capability: target.capability,
      takeover: target.capability === "ink",
      chunkSeq: 0,
      points: [],
    };
    const point = normalizedPoint(event);
    postPointer("pointer_start", {
      pointerId: event.pointerId,
      pointerType: String(event.pointerType || "unknown"),
      gestureToken,
      capability: target.capability,
      isPrimary: event.isPrimary,
      button: event.button,
      ...point,
    });
    if (activePointer.takeover) {
      try { target.owner?.setPointerCapture?.(event.pointerId); } catch {}
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener("pointermove", (event) => {
    const active = activePointer;
    if (!active || active.pointerId !== event.pointerId) return;
    const source = event.getCoalescedEvents?.() || [];
    const events = source.length ? source : [event];
    for (const pointEvent of events) active.points.push(normalizedPoint(pointEvent));
    if (active.points.length > MAX_POINTS * 2) flushAllMoves();
    else scheduleMoves();
    if (active.takeover) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener("pointerup", (event) => {
    const active = activePointer;
    if (!active || active.pointerId !== event.pointerId) return;
    flushAllMoves();
    active.chunkSeq += 1;
    postPointer("pointer_end", {
      pointerId: active.pointerId,
      gestureToken: active.gestureToken,
      chunkSeq: active.chunkSeq,
      points: [normalizedPoint(event)],
    });
    if (active.takeover) {
      suppressedClick = { owner: active.target, until: performance.now() + 500 };
      event.preventDefault();
      event.stopPropagation();
    }
    clearActivePointer();
  }, true);

  document.addEventListener("pointercancel", (event) => {
    const active = activePointer;
    if (!active || active.pointerId !== event.pointerId) return;
    postPointer("pointer_cancel", { pointerId: active.pointerId, gestureToken: active.gestureToken });
    clearActivePointer();
  }, true);

  document.addEventListener("click", (event) => {
    const token = suppressedClick;
    if (!token || performance.now() > token.until) {
      suppressedClick = null;
      return;
    }
    if (token.owner && event.target instanceof Node && token.owner !== event.target && !token.owner.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    suppressedClick = null;
  }, true);

  document.addEventListener("load", (event) => {
    if (!pointerSession || !(event.target instanceof HTMLIFrameElement)) return;
    childPointerStates.set(event.target, "pending");
    if (pointerReady) {
      pointerReady = false;
      applyPointerMode("interaction-lock");
      clearActivePointer();
      reportRootCapabilities(true);
    }
    event.target.contentWindow?.postMessage(parentPointerMessage("pointer_hello"), "*");
  }, true);

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.source === "mathin-h5-media") {
      if (event.source !== parent) parent.postMessage(data, "*");
      return;
    }
    if (data.source === "mathin-classroom" && data.type === "media_ctl") applyControl(data);

    if (event.source === parent && isPointerParentMessage(data)) {
      if (data.type === "pointer_hello") {
        pointerSession = { frameId: data.frameId, channelToken: data.channelToken };
        pointerReady = false;
        applyPointerMode("interaction-lock");
        clearActivePointer();
        startChildHandshake();
        return;
      }
      if (!matchesPointerSession(data)) return;
      if (data.type === "pointer_ack") {
        pointerReady = rootProvider().compatible && allChildrenReady();
        applyPointerMode(data.mode);
        forwardToChildren(parentPointerMessage("pointer_ack", { mode: pointerMode }));
        return;
      }
      if (data.type === "pointer_mode") {
        applyPointerMode(data.mode);
        if (pointerMode !== "smart") clearActivePointer();
        forwardToChildren(parentPointerMessage("pointer_mode", { mode: pointerMode }));
        return;
      }
      if (data.type === "pointer_ping") {
        postPointer("pointer_pong");
        return;
      }
      if (data.type === "pointer_takeover") {
        takeoverActivePointer(data.gestureToken);
        forwardToChildren(parentPointerMessage("pointer_takeover", { gestureToken: data.gestureToken }));
        return;
      }
      if (data.type === "pointer_abort") {
        abortActivePointer(data.gestureToken);
        forwardToChildren(parentPointerMessage("pointer_abort", { gestureToken: data.gestureToken }));
      }
      return;
    }

    const childFrame = childFrameForSource(event.source);
    if (!childFrame || !isPointerFrameMessage(data) || !matchesPointerSession(data)) return;
    if (data.type === "pointer_capabilities") {
      const compatible = data.providerSchema === INPUT_PROVIDER_SCHEMA
        && data.providerVersion === INPUT_PROVIDER_VERSION
        && capabilities.includes(data.defaultCapability);
      childPointerStates.set(childFrame, compatible ? "ready" : "incompatible");
      if (compatible) {
        childFrame.contentWindow?.postMessage(parentPointerMessage("pointer_ack", { mode: pointerMode }), "*");
        if (allChildrenReady()) reportRootCapabilities();
      } else {
        pointerReady = false;
        applyPointerMode("interaction-lock");
        clearActivePointer();
        reportRootCapabilities(true);
      }
      return;
    }
    relayChildPointer(data, childFrame);
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

const H5_PROVIDER_ATTRIBUTE = /\sdata-classroom-(?:input-provider|renderer-version|input-default)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi;

/**
 * Remove every source-supplied provider declaration and attach only the
 * registry-authoritative profile. Missing profiles deliberately fail closed.
 */
export function applyH5InputProfile(html: string, profile: H5InputProfile | null = null): string {
  return html.replace(/<html\b[^>]*>/i, (root) => {
    const clean = root.replace(H5_PROVIDER_ATTRIBUTE, "");
    if (!profile) return clean;
    const attributes = ` data-classroom-input-provider="${profile.providerSchema}"`
      + ` data-classroom-renderer-version="${profile.providerVersion}"`
      + ` data-classroom-input-default="${profile.defaultCapability}"`;
    return clean.replace(/>$/, `${attributes}>`);
  });
}

export function injectH5Runtime(html: string, profile: H5InputProfile | null = null): string {
  return injectHeadSnippet(applyH5InputProfile(html, profile), H5_OPAQUE_ORIGIN_RUNTIME);
}
