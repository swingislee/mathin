"use client";

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { spatialToolbarPlacement } from "../spatial-interaction/toolbar-placement";
import { toolbarDomObstacles, watchToolbarLayout } from "../spatial-interaction/toolbar-obstacles";
import type { PlanarContextActions } from "./types";

type Bounds = PlanarContextActions["bounds"];
type Matrix = Pick<DOMMatrix, "a" | "b" | "c" | "d" | "e" | "f">;

/** SVG 实际屏幕变换包含等比留白，不能直接按容器宽高换算场景坐标。 */
export function planarToolbarFootprint(bounds: Bounds, matrix: Matrix, origin: { left: number; top: number }) {
  const points = [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY],
  ].map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + matrix.e - origin.left, y: matrix.b * x + matrix.d * y + matrix.f - origin.top }));
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return { left: Math.min(...points.map((point) => point.x)) - 14, top: Math.min(...points.map((point) => point.y)) - 14,
    right: Math.max(...points.map((point) => point.x)) + 14, bottom: Math.max(...points.map((point) => point.y)) + 14 };
}

/** 平面坐标映射复用空间任务条的对象外避让规则，无空位时保留右栏入口。 */
export function PlanarObjectToolbar({ svg, bounds, children }: { svg: RefObject<SVGSVGElement | null>; bounds: Bounds; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = element.current, canvas = svg.current, parent = node?.parentElement;
    if (!node || !canvas || !parent) return;
    const position = () => {
      const matrix = canvas.getScreenCTM(), area = parent.getBoundingClientRect();
      const footprint = matrix && planarToolbarFootprint(bounds, matrix, area);
      const placement = footprint && spatialToolbarPlacement(footprint, area, { width: node.offsetWidth, height: node.offsetHeight }, "top", toolbarDomObstacles(parent, node, area));
      node.style.visibility = placement ? "visible" : "hidden";
      if (placement) { node.style.left = `${placement.x}px`; node.style.top = `${placement.y}px`; }
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(node); observer.observe(canvas); observer.observe(parent);
    const stop = watchToolbarLayout(parent, node, position);
    window.addEventListener("resize", position);
    return () => { observer.disconnect(); stop(); window.removeEventListener("resize", position); };
  }, [svg, bounds]);
  return <div ref={element} data-planar-object-toolbar style={{ position: "absolute", zIndex: 7, visibility: "hidden", width: "max-content", transform: "translate(-50%, -50%)" }}>{children}</div>;
}
