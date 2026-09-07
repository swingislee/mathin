"use client";

import type { ComponentProps } from "react";
import { VoxelModelCanvas, type VoxelModelCanvasProps } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import { CubeStructuresScene } from "./CubeStructuresScene";

/** Three/R3F 与场景预览一起按需加载，工具栏保持在轻量客户端边界。 */
export function CubeStructuresViewport({ scene, ...props }: VoxelModelCanvasProps & {
  readonly scene: ComponentProps<typeof CubeStructuresScene>;
}) {
  return <VoxelModelCanvas {...props} preserveSelectedColors sceneOverlay={<CubeStructuresScene {...scene} />} />;
}
