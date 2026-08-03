"use client";

import "katex/dist/katex.min.css";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import type { DocVideoControl } from "./DocStage";
import { injectBindingUrls, type ResolvedBindingUrls } from "./resolve";
import type { AixuexiItvEvent, AixuexiItvWidget, AixuexiPageDoc } from "./aixuexi-schema";
import { renderAixuexiMathHtml } from "./aixuexi-math";
import styles from "./aixuexi-stage.module.css";

export interface AixuexiStageProps {
  doc: AixuexiPageDoc;
  bindingUrls: ResolvedBindingUrls;
  stageMode?: "natural" | "board43";
  className?: string;
  interactive?: boolean;
  videoControl?: DocVideoControl;
  onAdvance?: () => void;
}

const BOARD_ASPECT = 4 / 3;

function HtmlContent({ html, bindingUrls }: { html: string; bindingUrls: ResolvedBindingUrls }) {
  const resolved = renderAixuexiMathHtml(injectBindingUrls(html, bindingUrls));
  return <div className={styles.html} dangerouslySetInnerHTML={{ __html: resolved }} />;
}

function widgetStyle(widget: AixuexiItvWidget): CSSProperties {
  return {
    left: widget.x,
    top: widget.y,
    width: widget.width,
    height: widget.height,
    zIndex: widget.zIndex,
    opacity: widget.opacity,
    transform: `rotate(${widget.rotation}deg)`,
  };
}

function ItvGame({
  event,
  bindingUrls,
  interactive,
  onContinue,
}: {
  event: AixuexiItvEvent;
  bindingUrls: ResolvedBindingUrls;
  interactive: boolean;
  onContinue: () => void;
}) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const groups = new Map(event.stage.groups.map((group) => [group.id, group]));
  const selected = selectedGroup ? groups.get(selectedGroup) ?? null : null;
  const passed = event.judgeType === "pass" || selected?.isAnswer === true;
  const gameScale = Math.min(1200 / event.stage.width, 560 / event.stage.height);

  return (
    <div className={styles.itvGame}>
      <div className={styles.itvGameFrame}>
        <div
          className={styles.itvGameStage}
          style={{ width: event.stage.width, height: event.stage.height, transform: `scale(${gameScale})` }}
        >
          {event.stage.widgets.map((widget) => {
            if (widget.type === "submit") return null;
            const group = widget.groupId ? groups.get(widget.groupId) : null;
            const isChoice = group?.type === "choice";
            const isSelected = selectedGroup === widget.groupId;
            return (
              <div
                key={widget.id}
                className={[
                  styles.itvWidget,
                  isChoice ? styles.itvChoice : "",
                  isSelected ? (passed ? styles.itvCorrect : styles.itvIncorrect) : "",
                ].filter(Boolean).join(" ")}
                data-itv-widget-id={widget.id}
                style={widgetStyle(widget)}
                onClick={(event_) => {
                  event_.stopPropagation();
                  if (interactive && isChoice && selectedGroup === null && widget.groupId) {
                    setSelectedGroup(widget.groupId);
                  }
                }}
              >
                {widget.type === "image" && widget.resourceBindingKey ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 课件 CAS signed/blob URL
                  <img
                    draggable={false}
                    alt={widget.name}
                    src={bindingUrls[widget.resourceBindingKey]}
                    className={styles.fillMedia}
                  />
                ) : widget.type === "text" && widget.html ? (
                  <HtmlContent html={widget.html} bindingUrls={bindingUrls} />
                ) : widget.type === "videoFrameTimer" ? (
                  <span className={styles.itvTimer}>互动</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.itvGameFooter}>
        <span>{selectedGroup === null ? "请选择答案" : event.judgeType === "pass" ? "已完成作答" : passed ? "回答正确" : "回答错误"}</span>
        {selectedGroup !== null ? (
          <Button size="sm" onClick={onContinue}>继续播放</Button>
        ) : null}
      </div>
    </div>
  );
}

function ItvOverlay({
  doc,
  bindingUrls,
  interactive,
  videoControl,
  onClose,
}: {
  doc: AixuexiPageDoc;
  bindingUrls: ResolvedBindingUrls;
  interactive: boolean;
  videoControl: DocVideoControl | undefined;
  onClose: () => void;
}) {
  const itv = doc.itvInteraction!;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeEventIndex, setActiveEventIndex] = useState<number | null>(null);
  const triggeredRef = useRef(new Set<number>());
  const applyingRef = useRef(false);
  const activeEvent = activeEventIndex === null ? null : itv.events[activeEventIndex] ?? null;

  const showEvent = (index: number) => {
    const video = videoRef.current;
    if (!video || !itv.events[index]) return;
    triggeredRef.current.add(index);
    video.pause();
    setActiveEventIndex(index);
  };

  useEffect(() => {
    const video = videoRef.current;
    const ctl = videoControl?.ctl;
    if (!video || !ctl) return;
    applyingRef.current = true;
    try {
      if (Number.isFinite(ctl.time)) video.currentTime = ctl.time;
      if (ctl.action === "play") void video.play().catch(() => undefined);
      if (ctl.action === "pause") video.pause();
    } finally {
      window.setTimeout(() => { applyingRef.current = false; }, 120);
    }
  }, [videoControl?.ctl?.evId, videoControl?.ctl]);

  const emit = (action: "play" | "pause" | "seek") => {
    if (!applyingRef.current) videoControl?.onCtl?.(action, videoRef.current?.currentTime ?? 0);
  };

  return (
    <div className={styles.overlay} onClick={(event) => event.stopPropagation()}>
      <div className={styles.overlayToolbar}>
        <strong>{itv.name} · {itv.eventCount} 个互动节点</strong>
        <Button size="sm" variant="secondary" onClick={() => {
          videoRef.current?.pause();
          onClose();
        }}>退出互动</Button>
      </div>
      <div className={styles.itvPlayer}>
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          src={bindingUrls[itv.videoBindingKey]}
          poster={itv.posterBindingKey ? bindingUrls[itv.posterBindingKey] : undefined}
          className={styles.fillMedia}
          onPlay={() => emit("play")}
          onPause={() => emit("pause")}
          onSeeked={() => emit("seek")}
          onTimeUpdate={(event) => {
            const index = itv.events.findIndex((item, cursor) =>
              !triggeredRef.current.has(cursor) && event.currentTarget.currentTime >= item.positionSeconds);
            if (index >= 0) showEvent(index);
          }}
        />
        {activeEvent ? (
          <ItvGame
            key={activeEvent.eventIndex}
            event={activeEvent}
            bindingUrls={bindingUrls}
            interactive={interactive}
            onContinue={() => {
              const video = videoRef.current;
              if (!video) return;
              video.currentTime = Math.max(video.currentTime, activeEvent.positionSeconds + 0.05);
              setActiveEventIndex(null);
              void video.play().catch(() => undefined);
            }}
          />
        ) : null}
      </div>
      <div className={styles.itvTimeline}>
        {itv.events.map((event, index) => (
          <Button
            key={event.eventIndex}
            size="sm"
            variant={activeEventIndex === index ? "primary" : "secondary"}
            disabled={!interactive}
            onClick={() => {
              if (videoRef.current) videoRef.current.currentTime = event.positionSeconds;
              showEvent(index);
            }}
          >
            节点 {index + 1} · {event.positionSeconds.toFixed(1)} 秒
          </Button>
        ))}
      </div>
    </div>
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
}: AixuexiStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [topicOpen, setTopicOpen] = useState(false);
  const [itvOpen, setItvOpen] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => setContainerWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(container);
    setContainerWidth(container.clientWidth);
    return () => observer.disconnect();
  }, []);

  const canvasAspect = doc.canvas.width / doc.canvas.height;
  const outerAspect = stageMode === "board43" ? BOARD_ASPECT : canvasAspect;
  const scale = containerWidth > 0 ? containerWidth / doc.canvas.width : 0;
  const background = doc.canvas.backgroundBindingKey
    ? bindingUrls[doc.canvas.backgroundBindingKey]
    : undefined;

  return (
    <div
      ref={containerRef}
      className={className}
      data-aixuexi-stage-mode={stageMode}
      style={{ position: "relative", width: "100%", aspectRatio: String(outerAspect), overflow: "hidden" }}
    >
      {stageMode === "board43" ? <div className={styles.boardBand} /> : null}
      <div
        key={`${doc.source.coursewareId}:${doc.source.pageDatabaseId}`}
        ref={stageRef}
        className={styles.stage}
        data-aixuexi-stage
        style={{
          width: doc.canvas.width,
          height: doc.canvas.height,
          transform: `scale(${scale})`,
          visibility: scale > 0 ? "visible" : "hidden",
        }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          const toggle = target.closest<HTMLElement>(".tk-answer-toggle,.tk-analysis-toggle");
          if (toggle && interactive) {
            event.stopPropagation();
            const container = toggle.closest(".tk-answer,.tk-analysis");
            const content = container?.querySelector<HTMLElement>(".tk-answers-content,.tk-analysises-content");
            if (content) {
              const opening = content.style.display === "none" || getComputedStyle(content).display === "none";
              content.style.display = opening ? "block" : "none";
              toggle.setAttribute("aria-expanded", String(opening));
            }
            return;
          }
          if (interactive && doc.behavior.advanceOnCanvasClick && !target.closest("button,a,iframe,video")) onAdvance?.();
        }}
      >
        {background ? (
          // eslint-disable-next-line @next/next/no-img-element -- 课件 CAS signed/blob URL
          <img alt="" src={background} className={styles.background} />
        ) : null}
        {doc.nodes.filter((node) => node.kind !== "background").map((node) => {
          const width = node.kind === "widget_html" && node.sourceType !== "a1"
            ? Math.min(node.width, Math.max(1, doc.canvas.width - node.x))
            : node.width;
          return (
            <div
              key={node.id}
              className={node.kind.startsWith("question_") || node.kind === "inline_question"
                ? styles.questionNode
                : styles.node}
              data-aix-source-type={node.sourceType}
              style={{
                left: node.x,
                top: node.y,
                width,
                height: node.height,
                zIndex: node.zIndex,
                transform: `rotate(${node.rotation}deg)`,
              }}
            >
              {node.kind === "itv_video" ? (
                <Button
                  className={styles.entryButton}
                  disabled={!interactive || !doc.itvInteraction}
                  onClick={(event) => {
                    event.stopPropagation();
                    setItvOpen(true);
                  }}
                >
                  进入互动视频
                  <small>{doc.itvInteraction?.eventCount ?? 0} 个互动节点</small>
                </Button>
              ) : node.html ? (
                <HtmlContent html={node.html} bindingUrls={bindingUrls} />
              ) : null}
            </div>
          );
        })}
        {doc.topicInteraction ? (
          <Button
            className={styles.topicButton}
            disabled={!interactive}
            onClick={(event) => {
              event.stopPropagation();
              setTopicOpen(true);
            }}
          >
            开始互动
          </Button>
        ) : null}
        {topicOpen && doc.topicInteraction ? (
          <div className={styles.overlay} onClick={(event) => event.stopPropagation()}>
            <div className={styles.overlayToolbar}>
              <strong>{doc.topicInteraction.entryKind}</strong>
              <Button size="sm" variant="secondary" onClick={() => setTopicOpen(false)}>退出互动</Button>
            </div>
            <iframe
              title={doc.source.pageName}
              src={bindingUrls[doc.topicInteraction.bindingKey]}
              sandbox="allow-scripts allow-forms allow-pointer-lock allow-modals"
              className={styles.topicFrame}
            />
          </div>
        ) : null}
        {itvOpen && doc.itvInteraction ? (
          <ItvOverlay
            doc={doc}
            bindingUrls={bindingUrls}
            interactive={interactive}
            videoControl={videoControl}
            onClose={() => setItvOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
