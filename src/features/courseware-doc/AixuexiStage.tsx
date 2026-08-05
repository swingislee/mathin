"use client";

import "katex/dist/katex.min.css";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { AixuexiItvPlayer } from "./AixuexiItvPlayer";
import { renderAixuexiMathHtml } from "./aixuexi-math";
import { observePresentation, revealStep } from "./aixuexi-presentation";
import type { AixuexiPageDoc } from "./aixuexi-schema";
import type { DocVideoControl } from "./DocStage";
import { injectBindingUrls, type ResolvedBindingUrls } from "./resolve";
import styles from "./aixuexi-stage.module.css";

/**
 * 爱学习成品页舞台。
 *
 * **母版是 1200×900,正好 4:3**;16:9 只是源播放器把母版 contain 进画框的结果
 * (缩 0.75、左右各留 150),由 `doc.presentation` 描述。因此两轨的关系与 E 系列相反:
 *
 * - `board43`(课堂 4:3 舞台 / adapted-4x3 轨):母版 1:1 铺满,内容比源站大 33%,
 *   **没有板书带** —— 板书带是 E 系列 16:9 内容进 4:3 的补偿,这里内容本来就是 4:3。
 *   背景是 16:9 装饰图,`object-fit: cover` 裁出的中央 4:3 恰好等于源站放内容的那块区域。
 * - `natural`(native-16x9 轨):按 presentation 还原源站画框,内容居中 pillarbox。
 *
 * 曾经把画布写成 1200×675 并让节点沿用 900 空间的坐标,结果 1525 页里有 876 页
 * 底部内容被裁掉 —— 改动画布语义前请先读 `docs/plan/16-p6-courseware-platform.md` §12。
 */

export interface AixuexiStageProps {
  doc: AixuexiPageDoc;
  bindingUrls: ResolvedBindingUrls;
  stageMode?: "natural" | "board43";
  className?: string;
  interactive?: boolean;
  videoControl?: DocVideoControl;
  onAdvance?: () => void;
}

function nodeStyle(node: AixuexiPageDoc["nodes"][number], yOffset: number, width: number): CSSProperties {
  return {
    left: node.x,
    top: node.y - yOffset,
    width,
    height: node.height,
    zIndex: node.zIndex,
    transform: `rotate(${node.rotation}deg)`,
  };
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
  const t = useTranslations("coursewareStage");
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<{ steps: HTMLElement[]; cursor: number }>({ steps: [], cursor: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [topicOpen, setTopicOpen] = useState(false);
  const [itvOpen, setItvOpen] = useState(false);

  const sourceFramed = stageMode !== "board43";
  const frameWidth = sourceFramed ? doc.presentation.width : doc.canvas.width;
  const frameHeight = sourceFramed ? doc.presentation.height : doc.canvas.height;
  const fit = containerWidth > 0 ? containerWidth / frameWidth : 0;
  const contentScale = sourceFramed ? fit * doc.presentation.contentScale : fit;
  const offsetX = sourceFramed ? doc.presentation.offsetX * fit : 0;
  const offsetY = sourceFramed ? doc.presentation.offsetY * fit : 0;

  const url = (key: string | null) => (key ? bindingUrls[key] : undefined);
  const background = url(doc.canvas.backgroundBindingKey);
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

  // 源站 HTML 注入后才能量几何,呈现规则一律在这里施加并持续跟随子树变化。
  const answerLabel = t("disclosureAnswer");
  const analysisLabel = t("disclosureAnalysis");
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // 供浏览器验收断言「呈现规则已施加」,不参与渲染。
    stage.dataset.aixPresentation = "applied";
    return observePresentation(stage, {
      shapeTextMinFontSize: doc.behaviors.shapeTextFit?.minFontSize ?? null,
      stagedReveal: doc.behaviors.stagedReveal,
      disclosureLabels: { answer: answerLabel, analysis: analysisLabel },
      onRevealSteps: (steps) => {
        // 重排后步骤列表会重建,已揭示的部分按游标补回,不让进度倒退。
        const cursor = Math.min(revealRef.current.cursor, steps.length);
        for (let index = 0; index < cursor; index += 1) revealStep(steps[index]);
        revealRef.current = { steps, cursor };
      },
    });
  }, [doc, answerLabel, analysisLabel]);

  const html = (raw: string) => renderAixuexiMathHtml(injectBindingUrls(raw, bindingUrls));

  const renderNode = (node: AixuexiPageDoc["nodes"][number], yOffset = 0) => {
    if (node.kind === "background") return null;
    // 源站单题页把题目部件宽度夹到画布右边界,防止长题横向溢出。
    const width = node.sourceType === "question-tk" && clampWidth !== null
      ? Math.min(node.width, clampWidth)
      : node.width;
    const isQuestion = node.kind === "inline_question" || node.kind.startsWith("question_");
    return (
      <div
        key={node.id}
        className={[
          "aix-layout-node",
          styles.node,
          isQuestion ? styles.questionNode : styles.widgetNode,
        ].join(" ")}
        data-aix-source-type={node.sourceType}
        style={nodeStyle(node, yOffset, width)}
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
            {t("enterItv")}
            <small>
              {doc.itvInteraction
                ? t("itvNodeCount", { count: doc.itvInteraction.eventCount })
                : t("itvNotReady")}
            </small>
          </Button>
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
    if (target.closest('button,a,input,select,textarea,video,audio,iframe,[role="button"]')) return;
    // 分步揭示优先于翻页:先把填空/总结逐个显形,走完才允许推进页面。
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

  const hasReveal = doc.behaviors.stagedReveal.underlineCount + doc.behaviors.stagedReveal.summaryWidgetCount > 0;

  return (
    <div
      ref={containerRef}
      className={[styles.frame, className].filter(Boolean).join(" ")}
      data-aixuexi-stage-mode={stageMode}
      style={{ aspectRatio: String(frameWidth / frameHeight) }}
    >
      {background ? (
        // eslint-disable-next-line @next/next/no-img-element -- 课件 CAS signed URL
        <img alt="" src={background} className={styles.background} />
      ) : null}
      <div
        ref={stageRef}
        className={[
          styles.stage,
          interactive && (hasReveal || doc.behavior.advanceOnCanvasClick) ? styles.advanceable : "",
        ].filter(Boolean).join(" ")}
        data-aixuexi-stage
        style={{
          width: doc.canvas.width,
          height: doc.canvas.height,
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${contentScale})`,
          visibility: contentScale > 0 ? "visible" : "hidden",
        }}
        onClick={advance}
      >
        {fixedNodes.map((node) => renderNode(node))}
        {split ? (
          <div
            className={styles.questionScroll}
            data-aix-question-scroll
            style={{ top: split.top, height: split.height }}
          >
            <div className={styles.questionScrollContent} style={{ height: split.contentHeight }}>
              {scrollNodes.map((node) => renderNode(node, split.top))}
            </div>
          </div>
        ) : null}
      </div>

      {doc.topicInteraction ? (
        <Button
          className={styles.topicButton}
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
        <div className={styles.overlay} onClick={(event) => event.stopPropagation()}>
          <div className={styles.overlayToolbar}>
            <strong>{doc.topicInteraction.entryKind}</strong>
            <Button size="sm" variant="secondary" onClick={() => setTopicOpen(false)}>{t("exitTopic")}</Button>
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
