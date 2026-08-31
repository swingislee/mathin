"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { DocVideoControl } from "./DocStage";
import type { H5PointerBridgeHost } from "./h5-pointer-protocol";
import type { ResolvedBindingUrls } from "./resolve";
import { coursewareCanvasStyle } from "./courseware-surface";
import {
  markSourceRuntimeNestedH5Url,
  SOURCE_RUNTIME_PROTOCOL,
  type SourceRuntimePageDoc,
} from "./source-runtime-schema";
import { sourceRuntimeFourByThreeMode } from "./source-runtime-four-by-three";
import { useH5FrameRegistration } from "./useH5FrameRegistration";

const FRAME_MESSAGE_SOURCE = "mathin-source-runtime";
const HOST_MESSAGE_SOURCE = "mathin-source-runtime-host";

export interface SourceRuntimeStageProps {
  doc: SourceRuntimePageDoc;
  bindingUrls: ResolvedBindingUrls;
  stageMode?: "natural" | "board43";
  className?: string;
  interactive?: boolean;
  videoControl?: DocVideoControl;
  onAdvance?: () => void;
  h5PointerBridge?: H5PointerBridgeHost;
}

interface RuntimePayload {
  source: typeof HOST_MESSAGE_SOURCE;
  protocol: typeof SOURCE_RUNTIME_PROTOCOL;
  type: "render";
  renderKey: string;
  format: string;
  data: Record<string, unknown>;
  resources: Record<string, string>;
  routes: Record<string, string>;
  interactive: boolean;
  advanceOnCanvasClick: boolean;
}

function materializePayload(
  doc: SourceRuntimePageDoc,
  bindingUrls: ResolvedBindingUrls,
  interactive: boolean,
  renderKey: string,
): RuntimePayload | null {
  const resources: Record<string, string> = {};
  for (const [resourceId, bindingKey] of Object.entries(doc.bindings.resources)) {
    const url = bindingUrls[bindingKey];
    if (!url) return null;
    resources[resourceId] = url;
  }
  const routes: Record<string, string> = {};
  for (const route of doc.bindings.routes) {
    const url = bindingUrls[route.bindingKey];
    if (!url) return null;
    routes[route.path] = markSourceRuntimeNestedH5Url(url);
  }
  return {
    source: HOST_MESSAGE_SOURCE,
    protocol: SOURCE_RUNTIME_PROTOCOL,
    type: "render",
    renderKey,
    format: doc.payload.format,
    data: doc.payload.data,
    resources,
    routes,
    interactive,
    advanceOnCanvasClick: doc.behavior.advanceOnCanvasClick,
  };
}

export default function SourceRuntimeStage({
  doc,
  bindingUrls,
  stageMode = "natural",
  className,
  interactive = true,
  videoControl,
  onAdvance,
  h5PointerBridge,
}: SourceRuntimeStageProps) {
  const t = useTranslations("coursewareStage");
  const frameId = `source-runtime/${doc.source.coursewareId}/${doc.source.pageDatabaseId}`;
  const { iframeRef, frameGeneration, onFrameLoad } = useH5FrameRegistration(h5PointerBridge, frameId);
  const [renderedFrameKey, setRenderedFrameKey] = useState<string | null>(null);
  const [runtimeFailure, setRuntimeFailure] = useState<{ frameKey: string; message: string } | null>(null);
  const appliedCtl = useRef<DocVideoControl["ctl"]>(undefined);
  const runtimeReadyFor = useRef<string | null>(null);
  const runtimeLoadedFor = useRef<string | null>(null);
  const runtimePayloadSentFor = useRef<string | null>(null);
  const runtimeInFlightFor = useRef<string | null>(null);
  const runtimeQueuedRender = useRef<{ frameKey: string; payload: RuntimePayload } | null>(null);
  const runtimeInstanceFor = useRef<string | null>(null);
  const runtimeEntry = bindingUrls[doc.runtime.bindingKey];
  // The runtime package is shared by every page in a source courseware. Keep
  // that iframe alive while only the render payload changes between pages;
  // reloading the immutable viewer bundle on every page turn is the dominant
  // source-preview latency. A different package/entry still remounts safely.
  const runtimeInstanceKey = `${doc.runtime.packageHash}:${runtimeEntry ?? "missing"}`;
  const renderKey = `${runtimeInstanceKey}:${doc.source.coursewareId}:${doc.source.pageDatabaseId}`;
  const rendered = renderedFrameKey === renderKey;
  const hasRenderedCurrentRuntime = renderedFrameKey?.startsWith(`${runtimeInstanceKey}:`) ?? false;
  const runtimeError = runtimeFailure?.frameKey === renderKey ? runtimeFailure.message : null;
  const payload = useMemo(
    () => materializePayload(doc, bindingUrls, interactive, renderKey),
    [bindingUrls, doc, interactive, renderKey],
  );

  const flushRuntimeRender = useCallback(() => {
    if (runtimeReadyFor.current !== runtimeInstanceKey
        && runtimeLoadedFor.current !== runtimeInstanceKey) return;
    if (runtimeInFlightFor.current) return;
    const next = runtimeQueuedRender.current;
    if (!next) return;
    runtimeQueuedRender.current = null;
    if (runtimePayloadSentFor.current === next.frameKey) return;
    runtimeInFlightFor.current = next.frameKey;
    runtimePayloadSentFor.current = next.frameKey;
    iframeRef.current?.contentWindow?.postMessage(next.payload, "*");
  }, [iframeRef, runtimeInstanceKey]);

  const queueRuntimeRender = useCallback((frameKey: string, nextPayload: RuntimePayload) => {
    if (runtimePayloadSentFor.current === frameKey) return;
    // The source Viewer mutates one document and one captured-player global.
    // Keep at most one render in flight and retain only the newest requested
    // page so fast paging cannot overlap two source modules inside that frame.
    runtimeQueuedRender.current = { frameKey, payload: nextPayload };
    flushRuntimeRender();
  }, [flushRuntimeRender]);

  useLayoutEffect(() => {
    if (runtimeInstanceFor.current === runtimeInstanceKey) return;
    runtimeInstanceFor.current = runtimeInstanceKey;
    runtimeReadyFor.current = null;
    runtimeLoadedFor.current = null;
    runtimePayloadSentFor.current = null;
    runtimeInFlightFor.current = null;
    runtimeQueuedRender.current = null;
  }, [runtimeInstanceKey]);

  useEffect(() => {
    if (payload) queueRuntimeRender(renderKey, payload);
  }, [payload, queueRuntimeRender, renderKey]);

  // The source Viewer can render a lightweight page between the iframe load
  // event and React's passive-effect flush. Install the message listener in
  // the layout phase so its immediate `rendered` acknowledgement is never
  // lost; otherwise the host can remain on the loading veil until remounted.
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as { source?: unknown; protocol?: unknown; type?: unknown; renderKey?: unknown; message?: unknown; action?: unknown; time?: unknown };
      if (message.source === FRAME_MESSAGE_SOURCE && message.protocol === SOURCE_RUNTIME_PROTOCOL) {
        if (message.type === "ready") {
          runtimeReadyFor.current = runtimeInstanceKey;
          flushRuntimeRender();
        }
        if (message.type === "rendered") {
          const completedRenderKey = typeof message.renderKey === "string"
            ? message.renderKey
            : runtimeInFlightFor.current;
          if (completedRenderKey && completedRenderKey === runtimeInFlightFor.current) {
            runtimeInFlightFor.current = null;
            setRenderedFrameKey(completedRenderKey);
            setRuntimeFailure((current) => current?.frameKey === completedRenderKey ? null : current);
            flushRuntimeRender();
          }
        }
        if (message.type === "advance") onAdvance?.();
        if (message.type === "error") {
          const failedRenderKey = typeof message.renderKey === "string"
            ? message.renderKey
            : runtimeInFlightFor.current;
          if (failedRenderKey && failedRenderKey === runtimeInFlightFor.current) {
            runtimeInFlightFor.current = null;
            setRuntimeFailure({
              frameKey: failedRenderKey,
              message: typeof message.message === "string" ? message.message : t("sourceRuntimeUnavailable"),
            });
            flushRuntimeRender();
          }
        }
        return;
      }
      if (message.source !== "mathin-h5-media"
          || !videoControl?.controller
          || !videoControl.onCtl
          || !["play", "pause", "seek"].includes(String(message.action))
          || typeof message.time !== "number") return;
      videoControl.onCtl(message.action as "play" | "pause" | "seek", message.time);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [flushRuntimeRender, iframeRef, onAdvance, runtimeInstanceKey, t, videoControl]);

  useEffect(() => {
    const ctl = videoControl?.ctl;
    if (!videoControl || videoControl.controller || !ctl || frameGeneration === 0 || appliedCtl.current === ctl) return;
    appliedCtl.current = ctl;
    iframeRef.current?.contentWindow?.postMessage({
      source: "mathin-classroom",
      type: "media_ctl",
      action: ctl.action,
      time: ctl.time,
    }, "*");
  }, [frameGeneration, iframeRef, videoControl]);

  const sourceAspect = doc.viewport.width / doc.viewport.height;
  const outerAspect = stageMode === "board43" ? 4 / 3 : sourceAspect;
  const fourByThreeMode = sourceRuntimeFourByThreeMode(doc);
  const directFourByThree = stageMode === "board43" && fourByThreeMode === "source-master";
  const sourceHeightPercent = directFourByThree
    ? 100
    : Math.min(100, (outerAspect / sourceAspect) * 100);
  const sourceWidthPercent = directFourByThree ? (sourceAspect / outerAspect) * 100 : 100;
  const sourceLeftPercent = directFourByThree ? (100 - sourceWidthPercent) / 2 : 0;
  const unavailable = !runtimeEntry || !payload;

  return (
    <div
      className={className}
      data-source-runtime-stage
      data-stage-mode={stageMode}
      data-four-by-three-mode={stageMode === "board43" ? fourByThreeMode : undefined}
      style={{
        ...coursewareCanvasStyle("#fff"),
        position: "relative",
        width: "100%",
        aspectRatio: String(outerAspect),
        overflow: "hidden",
      }}
    >
      {stageMode === "board43" && sourceHeightPercent < 100 ? (
        <div className="absolute inset-x-0 bottom-0 bg-card" style={{ height: `${100 - sourceHeightPercent}%` }} />
      ) : null}
      <div
        className="absolute top-0"
        style={{
          left: `${sourceLeftPercent}%`,
          width: `${sourceWidthPercent}%`,
          height: `${sourceHeightPercent}%`,
        }}
      >
        {runtimeEntry ? (
          <iframe
            ref={iframeRef}
            key={runtimeInstanceKey}
            title={doc.source.pageName}
            src={runtimeEntry}
            sandbox="allow-scripts allow-forms allow-pointer-lock allow-modals"
            allow="autoplay; fullscreen"
            allowFullScreen
            data-classroom-input="native"
            onLoad={() => {
              // The child runtime posts `ready` and can finish rendering before
              // the parent effect is installed. Treat `load` as the second side
              // of the same handshake and send the payload at most once.
              runtimeLoadedFor.current = runtimeInstanceKey;
              flushRuntimeRender();
              onFrameLoad();
            }}
            className="absolute inset-0 block size-full border-0 bg-white"
          />
        ) : null}
        {!rendered && !hasRenderedCurrentRuntime && !runtimeError && !unavailable ? (
          <div className="absolute inset-0 grid place-items-center bg-paper text-sm text-muted" aria-live="polite">
            {t("sourceRuntimeLoading")}
          </div>
        ) : null}
        {runtimeError || unavailable ? (
          <div className="absolute inset-0 grid place-items-center bg-paper px-6 text-center text-sm text-danger" role="alert">
            {runtimeError ?? t("sourceRuntimeUnavailable")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
