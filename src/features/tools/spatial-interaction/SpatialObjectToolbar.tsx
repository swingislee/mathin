"use client";

import { useCallback, useRef, type ReactNode } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { Camera, Object3D } from "three";
import type { VoxelCoordinate } from "@/features/spatial-math/domain";
import { spatialToolbarFootprint, spatialToolbarPlacement, type SpatialToolbarHandles, type SpatialToolbarSide } from "./toolbar-placement";
import { spatialSceneObstacles, toolbarDomObstacles, watchToolbarLayout } from "./toolbar-obstacles";

export interface SpatialObjectToolbarTarget {
  center: VoxelCoordinate;
  /** 当前展示姿态的世界坐标顶点，包含单元块自身的大小。 */
  vertices: readonly VoxelCoordinate[];
  moveHandles?: SpatialToolbarHandles;
}

/** 对象动作、旋转与翻滚共用屏幕避让；布局只影响 HTML，不移动模型或相机。 */
export function SpatialObjectToolbar({ center, vertices, moveHandles, preferredSide = "top", children }: SpatialObjectToolbarTarget & { children: ReactNode; preferredSide?: SpatialToolbarSide }) {
  const invalidate = useThree((state) => state.invalidate);
  const scene = useThree((state) => state.scene), canvas = useThree((state) => state.gl.domElement);
  const connected = useThree((state) => state.events.connected);
  const overlay = connected instanceof HTMLElement ? connected : canvas.parentElement;
  const element = useRef<HTMLDivElement | null>(null);
  const measured = useRef({ width: 0, height: 0 }), side = useRef<SpatialToolbarSide>(preferredSide);
  const attach = useCallback((node: HTMLDivElement | null) => {
    element.current = node;
    if (!node) return;
    node.dataset.spatialObjectToolbar = "";
    const measure = () => { measured.current = { width: node.offsetWidth, height: node.offsetHeight }; invalidate(); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    const scope = canvas.closest("[data-workbench-mode]") ?? canvas.parentElement;
    const stop = scope && watchToolbarLayout(scope, node.parentElement ?? node, invalidate);
    return () => { observer.disconnect(); stop?.(); element.current = null; };
  }, [invalidate, canvas]);
  const calculatePosition = useCallback((_object: Object3D, camera: Camera, size: { width: number; height: number }): [number, number] => {
    const footprint = spatialToolbarFootprint(vertices, moveHandles ?? { center, axes: ["x", "y", "z"] }, camera, size);
    const node = element.current, scope = canvas.closest("[data-workbench-mode]") ?? canvas.parentElement;
    const obstacles = spatialSceneObstacles(scene, camera, size);
    if (node && scope) obstacles.push(...toolbarDomObstacles(scope, node, canvas.getBoundingClientRect(), overlay ?? undefined));
    const placement = footprint && spatialToolbarPlacement(footprint, size, measured.current, side.current, obstacles);
    if (element.current) element.current.style.visibility = placement ? "visible" : "hidden";
    if (!placement) return [-10000, -10000];
    side.current = placement.side;
    return [placement.x, placement.y];
  }, [center, vertices, moveHandles, canvas, scene, overlay]);
  return <Html ref={attach} position={[center.x, center.y, center.z]} center calculatePosition={calculatePosition} zIndexRange={[7, 0]} style={{ visibility: "hidden" }}>
    {children}
  </Html>;
}
