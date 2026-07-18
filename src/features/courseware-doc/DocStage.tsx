"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./doc-stage.css";
import type { DocNode, PageDoc } from "./schema";
import { injectBindingUrls, type ResolvedBindingUrls } from "./resolve";
import { createInteractionRuntime, type InteractionRuntime, type InteractionTrigger } from "./interactions";

/**
 * page-doc-v1 舞台渲染器——镜像 viewer renderedNodeHtmlV2 的 React 移植,
 * 行为基准逐项对齐(docs/plan/16 §3 D5):节点仿射、crop 百分比图、adapter 分发、
 * visible=false 即 display:none(enter 目标初始隐藏)、节点级 click 触发器标记。
 *
 * 舞台模式(§6.1 轨道一,纯渲染变换、doc 零改动):
 * - natural:按 canvas 宽高比呈现(预览/编辑用);
 * - board43:4:3 舞台。16:9 页等比缩放后顶端对齐,内容占上部 75%,下部 25%
 *   为教师板书带;4:3 页(canvas 960×720)满幅、无板书带。
 *   点击命中、path 动画、richText 排版都包在同一个 scale 仿射里,无需单独换算。
 *
 * 内容 html/svg 由镜像端消毒并经导入无损门禁核验(sanitized: true),
 * 此处按契约直接注入;表格是课件内容的复原,必须用原生 <table>(非 UI 控件)。
 */

export interface DocStageProps {
  doc: PageDoc;
  bindingUrls: ResolvedBindingUrls;
  stageMode?: "natural" | "board43";
  className?: string;
  /** false = 舞台不响应本地点击(课堂学生端,步进只由 replaySteps 驱动);默认 true。 */
  interactive?: boolean;
  /** 本地点击实际触发步进时回调(课堂教师端借此广播 doc_step;P6-5)。 */
  onClickTrigger?: (trigger: InteractionTrigger) => void;
  /** 远端步进流:mount 时全量补放(晚加入/重进页),此后按序增量回放。 */
  replaySteps?: readonly InteractionTrigger[];
}

const RESOURCE_ROLES = ["source", "image", "src", "video", "poster", "background"];

function bindingUrl(node: DocNode, roles: readonly string[], urls: ResolvedBindingUrls): string | null {
  const resource =
    node.resources.find((item) => roles.includes(item.role)) ?? node.resources[0] ?? null;
  return resource ? (urls[resource.bindingKey] ?? null) : null;
}

function croppedImage(node: DocNode, src: string, alt: string): ReactNode {
  const crop = node.crop;
  if (!crop) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 舞台内容图走 blob/signed URL,豁免 next/image(08-§3.6)
      <img
        draggable={false}
        alt={alt}
        src={src}
        style={{ width: "100%", height: "100%", objectFit: node.style.objectFit ?? "contain" }}
      />
    );
  }
  const width = Math.max(0.001, node.transform.width);
  const height = Math.max(0.001, node.transform.height);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 同上
    <img
      draggable={false}
      alt={alt}
      src={src}
      style={{
        position: "absolute",
        maxWidth: "none",
        width: `${(crop.width / width) * 100}%`,
        height: `${(crop.height / height) * 100}%`,
        left: `${(-crop.x / width) * 100}%`,
        top: `${(-crop.y / height) * 100}%`,
        objectFit: "fill",
      }}
    />
  );
}

function textBlockStyle(node: DocNode): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    fontSize: `${node.style.fontSize ?? 16}px`,
    lineHeight: node.style.lineHeight ?? 1.4,
    textAlign: node.style.textAlign ?? "left",
  };
}

function nodeBody(node: DocNode, urls: ResolvedBindingUrls, clickTriggers: ReadonlySet<string>): ReactNode {
  const alt = node.content?.text || node.name || node.sourceType;
  const url = bindingUrl(node, RESOURCE_ROLES, urls);
  switch (node.adapter) {
    case "group":
    case "page":
      return node.children.map((child) => (
        <NodeView key={child.nodePath} node={child} urls={urls} clickTriggers={clickTriggers} />
      ));
    case "image":
      return url ? croppedImage(node, url, alt) : unknownBody(node);
    case "svg":
      if (node.content?.svg) {
        return (
          <div style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: node.content.svg }} />
        );
      }
      return url ? croppedImage(node, url, alt) : unknownBody(node);
    case "math_vertical":
      return url ? croppedImage(node, url, alt) : unknownBody(node);
    case "shape":
      return (
        <>
          <div
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            dangerouslySetInnerHTML={{ __html: node.content?.svg ?? "" }}
          />
          <div
            style={{ position: "absolute", inset: 0, ...textBlockStyle(node) }}
            dangerouslySetInnerHTML={{ __html: injectBindingUrls(node.content?.html ?? "", urls) }}
          />
        </>
      );
    case "video": {
      if (!url) return unknownBody(node);
      const poster = bindingUrl(node, ["poster", "thumbnail"], urls);
      return (
        <video
          controls
          preload="metadata"
          poster={poster ?? undefined}
          src={url}
          style={{ width: "100%", height: "100%", objectFit: node.style.objectFit ?? "contain" }}
        />
      );
    }
    case "audio":
      return url ? <audio controls src={url} style={{ width: "100%" }} /> : unknownBody(node);
    case "h5": {
      const entryUrl = node.resources.find((item) => item.role === "entry")
        ? (urls[node.resources.find((item) => item.role === "entry")!.bindingKey] ?? null)
        : null;
      if (!entryUrl) return unknownBody(node, `互动 · ${node.content?.status ?? "unavailable"}`);
      return (
        <iframe
          title={node.name ?? "互动"}
          src={entryUrl}
          // 垫片让 iframe 与站点同源,必须保持 opaque origin 隔离:
          // 只给 allow-scripts,严禁 allow-same-origin(doc 16 §9)。
          sandbox="allow-scripts"
          style={{ width: "100%", height: "100%", border: 0 }}
        />
      );
    }
    case "table": {
      const rows = node.content?.rows ?? [];
      return (
        <table style={{ width: "100%", height: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} style={{ border: "1px solid #64748b", padding: 3 }}>
                    {String(cell ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "rich_text":
      return (
        <div
          style={textBlockStyle(node)}
          dangerouslySetInnerHTML={{ __html: injectBindingUrls(node.content?.html ?? "", urls) }}
        />
      );
    case "text":
      return <div style={textBlockStyle(node)}>{node.content?.text ?? ""}</div>;
    default:
      return unknownBody(node);
  }
}

function unknownBody(node: DocNode, label?: string): ReactNode {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 8,
        background: "#fef3c7",
        color: "#92400e",
        fontSize: 12,
      }}
    >
      {label ?? `资源不可用或未支持节点:${node.sourceType}`}
    </div>
  );
}

function NodeView({
  node,
  urls,
  clickTriggers,
}: {
  node: DocNode;
  urls: ResolvedBindingUrls;
  clickTriggers: ReadonlySet<string>;
}) {
  const t = node.transform;
  const s = node.style;
  const clickTrigger = node.sourceResourceId && clickTriggers.has(node.sourceResourceId) ? node.sourceResourceId : "";
  const style: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: `${t.width}px`,
    height: `${t.height}px`,
    zIndex: node.zIndex,
    opacity: t.opacity,
    overflow: s.overflow,
    background: s.backgroundColor ?? "transparent",
    color: s.color ?? "inherit",
    borderRadius: `${s.borderRadius}px`,
    border: `${s.borderWidth}px solid ${s.borderColor ?? "transparent"}`,
    transformOrigin: `${t.anchorX * 100}% ${t.anchorY * 100}%`,
    transform: `translate(${t.x}px,${t.y}px) rotate(${t.rotation}deg) scale(${t.flipX ? -t.scaleX : t.scaleX},${t.flipY ? -t.scaleY : t.scaleY})`,
    display: node.visible ? "block" : "none",
    cursor: clickTrigger ? "pointer" : undefined,
  };
  return (
    <div
      data-node-path={node.nodePath}
      data-source-resource-id={node.sourceResourceId ?? ""}
      data-click-trigger={clickTrigger}
      style={style}
    >
      {nodeBody(node, urls, clickTriggers)}
    </div>
  );
}

const BOARD_ASPECT = 4 / 3;

export default function DocStage({
  doc,
  bindingUrls,
  stageMode = "natural",
  className,
  interactive = true,
  onClickTrigger,
  replaySteps,
}: DocStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const runtimeRef = useRef<InteractionRuntime | null>(null);
  // 回放游标:replaySteps 中已执行的条数。本地点击成功即预推进,
  // 让自己广播的 doc_step 回流时不被重复执行(课堂单写者=教师)。
  const appliedStepsRef = useRef(0);
  const onClickTriggerRef = useRef(onClickTrigger);
  // URL 表经 ref 供交互运行时读取:课堂预载是逐对象增量刷新 bindingUrls,
  // 若作为运行时 effect 依赖会反复 dispose/重放动画;节点 URL 更新走 React 渲染即可。
  const bindingUrlsRef = useRef(bindingUrls);
  useEffect(() => {
    onClickTriggerRef.current = onClickTrigger;
    bindingUrlsRef.current = bindingUrls;
  }, [onClickTrigger, bindingUrls]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(container);
    setContainerWidth(container.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const runtime = createInteractionRuntime({
      root: stage,
      interactions: doc.interactions,
      resolveAudioUrl: (bindingKey) => bindingUrlsRef.current[bindingKey] ?? null,
    });
    runtimeRef.current = runtime;
    appliedStepsRef.current = 0;
    void runtime.runAuto();
    const onClick = interactive
      ? (event: MouseEvent) => {
          void runtime.handleStageClick(event.target).then((trigger) => {
            if (!trigger) return;
            appliedStepsRef.current += 1;
            onClickTriggerRef.current?.(trigger);
          });
        }
      : null;
    if (onClick) stage.addEventListener("click", onClick);
    return () => {
      if (onClick) stage.removeEventListener("click", onClick);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [doc, interactive]);

  // 远端步进回放:mount 时把已记录的步进全量补放(晚加入/重进页与
  // 现场看课的观众收敛到同一舞台状态),此后每来一条增量执行一条。
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !replaySteps || replaySteps.length <= appliedStepsRef.current) return;
    const pending = replaySteps.slice(appliedStepsRef.current);
    appliedStepsRef.current = replaySteps.length;
    void (async () => {
      for (const step of pending) await runtime.runClick(step.scope, step.id);
    })();
  }, [replaySteps]);

  const canvas = doc.canvas;
  const canvasAspect = canvas.width / canvas.height;
  const scale = containerWidth > 0 ? containerWidth / canvas.width : 0;
  // board43:内容宽度占满舞台宽,16:9 内容高 = 宽×9/16 = 4:3 舞台高的 75%;
  // canvas 本身 ≤4:3(如 960×720)时满幅,无板书带。
  const showBoardBand = stageMode === "board43" && canvasAspect > BOARD_ASPECT + 0.001;
  const outerAspect = stageMode === "board43" ? BOARD_ASPECT : canvasAspect;
  const backgroundUrl = canvas.backgroundBindingKey ? (bindingUrls[canvas.backgroundBindingKey] ?? null) : null;
  const clickTriggers = new Set(
    doc.interactions
      .filter((item) => item.triggerScope === "node" && item.triggerResourceId !== null)
      .map((item) => item.triggerResourceId as string),
  );

  return (
    <div
      ref={containerRef}
      className={className}
      data-stage-mode={stageMode}
      style={{ position: "relative", width: "100%", aspectRatio: `${outerAspect}`, overflow: "hidden" }}
    >
      {showBoardBand ? (
        <div
          data-board-band
          className="bg-muted"
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "25%" }}
        />
      ) : null}
      <div
        // 换页必须整树 remount:交互运行时会直改节点行内样式,而各页节点的
        // nodePath key 相同,React 复用元素会把上一页的残留样式带进下一页。
        key={`${doc.sourceCoursewareId}:${doc.sourcePageDatabaseId}`}
        ref={stageRef}
        data-doc-stage
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          // 排版基准对齐镜像查看器 :root——字体与 line-height 直接决定
          // 文本折行位置,跟随站点字体会让旧课件文案换行点漂移。
          fontFamily: 'Inter, "Microsoft YaHei", system-ui, sans-serif',
          lineHeight: "normal",
          // color 是继承属性,preflight 中和层挡不住站点暗色主题的前景色
          // 渗入(MathJax SVG 用 currentColor 填充,暗色下文字直接隐形),
          // 在舞台根钉死 UA 默认黑并锁 light 配色域。
          color: "#000",
          colorScheme: "light",
          width: `${canvas.width}px`,
          height: `${canvas.height}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          overflow: "hidden",
          background: canvas.backgroundColor ?? "#fff",
          visibility: scale > 0 ? "visible" : "hidden",
        }}
      >
        {backgroundUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 舞台背景走 signed URL,豁免 next/image(08-§3.6)
          <img
            alt=""
            src={backgroundUrl}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
        {doc.nodes.map((node) => (
          <NodeView key={node.nodePath} node={node} urls={bindingUrls} clickTriggers={clickTriggers} />
        ))}
      </div>
    </div>
  );
}
