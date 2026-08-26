"use client";

import "katex/dist/katex.min.css";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { AixuexiItvPlayer } from "./AixuexiItvPlayer";
import { AixuexiNativeGame } from "./AixuexiNativeGame";
import { renderAixuexiMathHtml } from "./aixuexi-math";
import { observePresentation, revealStep } from "./aixuexi-presentation";
import {
  aixuexiRuntimeFileUrl,
  hydrateAixuexiSourceRuntime,
  installAixuexiWidgetReveal,
  type WidgetRevealController,
} from "./aixuexi-runtime";
import type { AixuexiPageDoc } from "./aixuexi-schema";
import type { DocVideoControl } from "./DocStage";
import type { H5PointerBridgeHost } from "./h5-pointer-protocol";
import { injectBindingUrls, type ResolvedBindingUrls } from "./resolve";
import { useH5FrameRegistration } from "./useH5FrameRegistration";
import styles from "./aixuexi-stage.module.css";

/**
 * 爱学习 projection v31 成品页舞台。
 *
 * ordinary slide 仍以 1200×900 建模，但源站实际是 1920×1080 player stage 承载
 * 背景/slideClass，再把 1200×900 child 以 1.2 倍居中；原生游戏则直接使用
 * 1920×1080。这里消费 doc.playerStage/doc.presentation，不再重造放大或 xmind 位移。
 */

export interface AixuexiStageProps {
  doc: AixuexiPageDoc;
  bindingUrls: ResolvedBindingUrls;
  stageMode?: "natural" | "board43";
  className?: string;
  interactive?: boolean;
  videoControl?: DocVideoControl;
  onAdvance?: () => void;
  h5PointerBridge?: H5PointerBridgeHost;
}

function sourceClassNames(value: string): string {
  return value.split(/\s+/).filter((token) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(token)).join(" ");
}

function nodeStyle(node: AixuexiPageDoc["nodes"][number], yOffset: number, width: number): CSSProperties {
  return {
    left: node.x,
    top: node.y - yOffset,
    width,
    height: node.height,
    zIndex: node.zIndex,
    transform: node.transform.trim() || `rotate(${node.rotation}deg)`,
    transformOrigin: node.transformOrigin || undefined,
  };
}

type PresentationGeometry = { width: number; height: number; contentScale: number; offsetX: number; offsetY: number };

function sourcePresentation(doc: AixuexiPageDoc): PresentationGeometry {
  const nodes = doc.nodes.filter((node) => node.kind !== "background");
  const wide = nodes.find((node) => node.kind === "embedded_h5"
    && node.embeddedH5?.presentationMode === "wide_crop"
    && node.x <= 1 && node.y <= 1 && node.width >= 1190 && node.height >= 890);
  const companions = nodes.filter((node) => node !== wide);
  if (!wide || companions.some((node) => node.width * node.height > 21600)) return doc.presentation;
  return {
    ...doc.presentation,
    contentScale: 1,
    offsetX: 0,
    offsetY: (doc.presentation.height - doc.canvas.height) / 2,
  };
}

function AixuexiEmbeddedH5Frame({
  frameId,
  title,
  src,
  presentationMode,
  pointerBridge,
}: {
  frameId: string;
  title: string;
  src: string | undefined;
  presentationMode: string;
  pointerBridge: H5PointerBridgeHost | undefined;
}) {
  const { iframeRef, onFrameLoad } = useH5FrameRegistration(pointerBridge, frameId);
  return (
    <iframe
      ref={iframeRef}
      title={title}
      src={src}
      sandbox="allow-scripts allow-forms allow-pointer-lock allow-modals"
      className={styles.embeddedFrame}
      data-aix-h5-presentation={presentationMode}
      data-classroom-input="native"
      onLoad={onFrameLoad}
    />
  );
}

export default function AixuexiStage({
  doc,
  bindingUrls,
  stageMode = "natural",
  className,
  interactive = true,
  videoControl,
  onAdvance,
  h5PointerBridge,
}: AixuexiStageProps) {
  const t = useTranslations("coursewareStage");
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<{ steps: HTMLElement[]; cursor: number }>({ steps: [], cursor: 0 });
  const widgetRevealRef = useRef<WidgetRevealController | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [topicOpen, setTopicOpen] = useState(false);
  const [itvOpen, setItvOpen] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const directFourByThree = stageMode === "board43" && doc.fourByThree.mode === "source-master";
  const compatibilityFourByThree = stageMode === "board43" && !directFourByThree;
  const frameWidth = 1200;
  const frameHeight = stageMode === "board43" ? 900 : 675;
  const fit = containerWidth > 0 ? containerWidth / frameWidth : 0;
  const presentation = useMemo(() => sourcePresentation(doc), [doc]);
  const playerScale = directFourByThree ? 1 : doc.playerStage.presentationScale;
  const outerScale = fit * playerScale;
  const innerScale = directFourByThree ? 1 : presentation.contentScale / doc.playerStage.presentationScale;
  const visualLeft = directFourByThree
    ? 0
    : (presentation.offsetX - doc.playerStage.offsetX) / doc.playerStage.presentationScale;
  const visualTop = directFourByThree
    ? doc.playerStage.contentPadding.top
    : (presentation.offsetY - doc.playerStage.offsetY) / doc.playerStage.presentationScale;
  const innerLeft = directFourByThree
    ? 0
    : visualLeft - (1 - innerScale) * doc.canvas.width / 2;
  const viewportHeight = Math.max(
    0,
    doc.canvas.height - doc.playerStage.contentPadding.top - doc.playerStage.contentPadding.bottom,
  );

  const url = (key: string | null) => (key ? bindingUrls[key] : undefined);
  const background = url(doc.canvas.backgroundBindingKey);
  const runtimeEntry = bindingUrls[doc.sourceRuntime.runtimeBindingKey];
  const runtimeCss = runtimeEntry
    ? aixuexiRuntimeFileUrl(runtimeEntry, doc.sourceRuntime.slideStylesheetPath)
    : null;
  const itvRuntimeCss = runtimeEntry
    ? aixuexiRuntimeFileUrl(runtimeEntry, doc.sourceRuntime.itvStylesheetPath)
    : null;
  const split = doc.behaviors.splitQuestionScroll;
  const clampWidth = doc.behaviors.singleQuestionScroll?.clampWidth ?? null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => setContainerWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(container);
    setContainerWidth(container.clientWidth);
    return () => observer.disconnect();
  }, []);

  const answerLabel = t("disclosureAnswer");
  const analysisLabel = t("disclosureAnalysis");
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.dataset.aixPresentation = "applied";
    return observePresentation(stage, {
      shapeTextMinFontSize: doc.behaviors.shapeTextFit?.minFontSize ?? null,
      stagedReveal: doc.behaviors.stagedReveal,
      disclosureLabels: { answer: answerLabel, analysis: analysisLabel },
      onRevealSteps: (steps) => {
        const cursor = Math.min(revealRef.current.cursor, steps.length);
        for (let index = 0; index < cursor; index += 1) revealStep(steps[index]);
        revealRef.current = { steps, cursor };
      },
    });
  }, [doc, answerLabel, analysisLabel]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    widgetRevealRef.current = installAixuexiWidgetReveal(stage);
    let cleanup: () => void = () => undefined;
    let disposed = false;
    setRuntimeError(null);
    hydrateAixuexiSourceRuntime(stage, doc, bindingUrls)
      .then((nextCleanup) => {
        if (disposed) nextCleanup();
        else cleanup = nextCleanup;
      })
      .catch((error: unknown) => {
        if (!disposed) setRuntimeError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      disposed = true;
      cleanup();
      widgetRevealRef.current = null;
    };
  }, [doc, bindingUrls]);

  const html = (raw: string) => renderAixuexiMathHtml(injectBindingUrls(raw, bindingUrls));

  const renderNode = (node: AixuexiPageDoc["nodes"][number], yOffset = 0) => {
    if (node.kind === "background") return null;
    const width = node.sourceType === "question-tk" && clampWidth !== null
      ? Math.min(node.width, clampWidth)
      : node.width;
    const isQuestion = node.kind === "inline_question" || node.kind.startsWith("question_");
    const classes = [
      "aix-layout-node",
      isQuestion ? "aix-question-node" : "aix-widget-node",
      node.kind === "itv_video" ? "aix-itv-node" : "",
      styles.node,
    ].filter(Boolean).join(" ");
    const inputCapability = node.embeddedH5
      ? "native"
      : node.topicClassification
        ? "drag"
        : "click";
    return (
      <div
        key={node.id}
        className={classes}
        data-aix-source-type={node.sourceType}
        data-aix-source-path={node.sourcePath}
        data-aix-animations={node.animations.length > 0 ? JSON.stringify(node.animations) : undefined}
        data-aix-reveal-step={node.revealStep > 0 ? node.revealStep : undefined}
        data-aix-question-kit={node.questionTkRuntime?.kit}
        data-aix-page-click-boundary={node.embeddedH5 ? "embedded_h5" : node.trueOrFalse || node.topicClassification ? "game" : undefined}
        data-classroom-input={inputCapability}
        style={nodeStyle(node, yOffset, width)}
      >
        {node.kind === "itv_video" ? (
          <Button
            className={styles.entryButton}
            data-classroom-input="click"
            disabled={!interactive || !doc.itvInteraction}
            onClick={(event) => {
              event.stopPropagation();
              setItvOpen(true);
            }}
          >
            {t("enterItv")}
            <small>{doc.itvInteraction ? t("itvNodeCount", { count: doc.itvInteraction.eventCount }) : t("itvNotReady")}</small>
          </Button>
        ) : node.embeddedH5 ? (
          <AixuexiEmbeddedH5Frame
            frameId={`aixuexi/${doc.source.coursewareId}/${doc.source.pageDatabaseId}/${node.id}`}
            title={node.title || doc.source.pageName}
            src={bindingUrls[node.embeddedH5.bindingKey]}
            presentationMode={node.embeddedH5.presentationMode}
            pointerBridge={h5PointerBridge}
          />
        ) : node.trueOrFalse || node.topicClassification ? (
          <AixuexiNativeGame node={node} bindingUrls={bindingUrls} interactive={interactive} />
        ) : node.html ? (
          <div className={`aix-html ${styles.html}`} dangerouslySetInnerHTML={{ __html: html(node.html) }} />
        ) : null}
      </div>
    );
  };

  const fixedNodes = split
    ? doc.nodes.filter((node) => node.kind === "background" || node.sourceType === "question-tk-head")
    : doc.nodes;
  const scrollNodes = split
    ? doc.nodes.filter((node) => node.kind !== "background" && node.sourceType !== "question-tk-head")
    : [];

  const advance = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!interactive) return;
    if (target.closest('button,a,input,select,textarea,video,audio,iframe,[role="button"],[data-aix-page-click-boundary]')) return;
    if (widgetRevealRef.current?.runNext()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const reveal = revealRef.current;
    if (reveal.cursor < reveal.steps.length) {
      event.preventDefault();
      event.stopPropagation();
      revealStep(reveal.steps[reveal.cursor]);
      reveal.cursor += 1;
      return;
    }
    if (doc.behavior.advanceOnCanvasClick) onAdvance?.();
  };

  const directBackgroundSize = doc.playerStage.backgroundSize.replace(/1080px\b/, "900px");
  const playerStyle: CSSProperties = directFourByThree ? {
    width: 1200,
    height: 900,
    backgroundImage: background ? `url(${background})` : undefined,
    backgroundSize: directBackgroundSize,
    backgroundPosition: doc.playerStage.backgroundPosition,
    backgroundRepeat: doc.playerStage.backgroundRepeat,
    backgroundColor: doc.playerStage.backgroundColor ?? undefined,
    transform: `scale(${outerScale})`,
  } : {
    width: doc.playerStage.width,
    height: doc.playerStage.height,
    backgroundImage: background ? `url(${background})` : undefined,
    backgroundSize: doc.playerStage.backgroundSize,
    backgroundPosition: doc.playerStage.backgroundPosition,
    backgroundRepeat: doc.playerStage.backgroundRepeat,
    backgroundColor: doc.playerStage.backgroundColor ?? undefined,
    transform: `scale(${outerScale})`,
  };

  return (
    <div
      ref={containerRef}
      className={["aix-layout-frame", styles.frame, className].filter(Boolean).join(" ")}
      data-aixuexi-stage-mode={stageMode}
      data-aixuexi-four-by-three={doc.fourByThree.mode}
      data-classroom-input="click"
      style={{ aspectRatio: String(frameWidth / frameHeight) }}
    >
      {runtimeCss ? <link rel="stylesheet" href={runtimeCss} data-aixuexi-slide-runtime /> : null}
      {itvRuntimeCss ? <link rel="stylesheet" href={itvRuntimeCss} data-aixuexi-itv-runtime /> : null}
      {compatibilityFourByThree ? <div className={styles.compatibilityBand} aria-hidden="true" /> : null}
      <div
        className={["aix-player-stage", sourceClassNames(doc.canvas.slideClass), styles.playerStage].filter(Boolean).join(" ")}
        data-aix-player-stage
        style={playerStyle}
      >
        <div
          ref={stageRef}
          className={["aix-layout-stage", styles.stage].join(" ")}
          data-aix-stage
          data-classroom-input="click"
          style={{
            width: doc.canvas.width,
            height: viewportHeight,
            left: innerLeft,
            top: visualTop,
            overflow: doc.playerStage.contentPadding.top || doc.playerStage.contentPadding.bottom ? "auto" : "visible",
            transform: `scale(${innerScale})`,
            visibility: outerScale > 0 ? "visible" : "hidden",
          }}
          onClick={advance}
        >
          {fixedNodes.map((node) => renderNode(node))}
          {split ? (
            <div
              className={styles.questionScroll}
              data-aix-question-scroll
              data-classroom-input="native"
              style={{ top: split.top, height: split.height }}
            >
              <div className={styles.questionScrollContent} style={{ height: split.contentHeight }}>
                {scrollNodes.map((node) => renderNode(node, split.top))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {runtimeError ? <div className={styles.runtimeError} role="alert">{runtimeError}</div> : null}

      {doc.topicInteraction ? (
        <Button
          className={styles.topicButton}
          data-classroom-input="click"
          disabled={!interactive || doc.topicInteraction.status !== "offline"}
          title={doc.topicInteraction.status === "offline" ? undefined : t("topicPendingHint")}
          onClick={(event) => {
            event.stopPropagation();
            setTopicOpen(true);
          }}
        >
          {doc.topicInteraction.status === "offline" ? t("enterTopic") : t("topicPending")}
        </Button>
      ) : null}

      {topicOpen && doc.topicInteraction?.bindingKey ? (
        <div className={styles.overlay} data-classroom-input="native" onClick={(event) => event.stopPropagation()}>
          <div className={styles.overlayToolbar}>
            <strong>{doc.topicInteraction.entryKind}</strong>
            <Button size="sm" variant="secondary" onClick={() => setTopicOpen(false)}>{t("exitTopic")}</Button>
          </div>
          <iframe
            title={doc.source.pageName}
            src={bindingUrls[doc.topicInteraction.bindingKey]}
            sandbox="allow-scripts allow-forms allow-pointer-lock allow-modals"
            className={styles.topicFrame}
            data-classroom-input="native"
          />
        </div>
      ) : null}

      {itvOpen && doc.itvInteraction ? (
        <AixuexiItvPlayer
          doc={doc}
          url={url}
          interactive={interactive}
          videoControl={videoControl}
          onClose={() => setItvOpen(false)}
        />
      ) : null}
    </div>
  );
}
