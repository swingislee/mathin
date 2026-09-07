"use client";

import { useMemo, type ComponentProps } from "react";
import { VoxelModelCanvas, type VoxelModelCanvasProps } from "@/features/spatial-math/renderer-r3f/VoxelCanvas";
import { CubeStructuresScene } from "./CubeStructuresScene";
import { cubeDisplayPosition, cubePaintGroups } from "./cube-structures-contract";
import { useCubeDisplayMotion } from "./useCubeDisplayMotion";

/** Three/R3F 与场景预览一起按需加载，工具栏保持在轻量客户端边界。 */
export function CubeStructuresViewport({ scene, sceneKey, opacityPreview, onMovingChange, ...props }: VoxelModelCanvasProps & {
  readonly scene: ComponentProps<typeof CubeStructuresScene>;
  readonly sceneKey: object;
  readonly opacityPreview: { readonly ids: readonly string[]; readonly opacity: number } | null;
  readonly onMovingChange: (moving: boolean) => void;
}) {
  const { presentation, moving } = useCubeDisplayMotion(scene.state, sceneKey, onMovingChange);
  const model = useMemo(() => {
    const positions = new Map(presentation.cubes.map((cube) => [cube.id, cubeDisplayPosition(cube)]));
    return { ...props.model, cells: props.model.cells.map((cell) => ({ ...cell, ...positions.get(cell.key),
      ...(opacityPreview?.ids.includes(cell.key) ? { opacity: opacityPreview.opacity } : {}) })) };
  }, [props.model, presentation.cubes, opacityPreview]);
  const paints = useMemo(() => cubePaintGroups(presentation), [presentation]);
  return <VoxelModelCanvas {...props} model={model} paintedFaceGroups={paints} readOnly={props.readOnly || moving}
    preserveSelectedColors sceneOverlay={<CubeStructuresScene {...scene} state={presentation} tool={moving ? "orbit" : scene.tool} />} />;
}
