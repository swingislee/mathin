"use client";

import { Suspense } from "react";
import { Billboard, Line, useTexture } from "@react-three/drei";
import { SRGBColorSpace } from "three";
import { buildVoxelPaintFaceInstances } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import type { VoxelFaceSelection } from "@/features/spatial-math/domain";
import { cubeAtDisplayPosition, cubeDisplayPosition, cubeIsVisible, type CubeColor, type CubeLabelPlacement, type CubeLabelStyle, type CubeMarkShape, type CubeStructureState, type CubeTool, type StructureCube } from "./cube-structures-contract";
import { cubeAnnotationSvg, cubeLabelAnchor } from "./cube-structures-annotations";

export interface CubeAnnotationPreview { readonly shape: CubeMarkShape; readonly placement: CubeLabelPlacement; readonly color: CubeColor; readonly value: number }
type SceneLabel = CubeLabelStyle & { readonly shape?: CubeMarkShape; readonly value?: number };

function Annotation({ cube, label, lane, preview = false }: { readonly cube: StructureCube; readonly label: SceneLabel; readonly lane: -1 | 0 | 1; readonly preview?: boolean }) {
  const texture = useTexture("data:image/svg+xml," + encodeURIComponent(cubeAnnotationSvg(label)), (loaded) => {
    if (!Array.isArray(loaded)) loaded.colorSpace = SRGBColorSpace;
  });
  const position = cubeLabelAnchor(cube, label, lane);
  const center = cubeDisplayPosition(cube);
  const face = buildVoxelPaintFaceInstances([center], [{ cell: center, direction: label.direction }])[0];
  const size = lane ? 0.4 : 0.6;
  const content = <mesh raycast={() => null} renderOrder={4}>
    <planeGeometry args={[size, size]} />
    <meshBasicMaterial map={texture} transparent opacity={preview ? 0.65 : 1} alphaTest={0.04} depthTest={!preview || label.placement !== "center"} depthWrite={false} toneMapped={false} />
  </mesh>;
  return <>
    {label.placement === "side" && <Line points={[[center.x, center.y, center.z], [position.x, position.y, position.z]]} color={label.color} lineWidth={1} raycast={() => null} />}
    {label.placement === "face" ? <group position={[position.x, position.y, position.z]} rotation={[face.rotation.x, face.rotation.y, face.rotation.z]}>{content}</group>
      : <Billboard position={[position.x, position.y, position.z]}>{content}</Billboard>}
  </>;
}

export function CubeStructureAnnotations({ state, tool, face, annotation }: { readonly state: CubeStructureState; readonly tool: CubeTool; readonly face: VoxelFaceSelection | null; readonly annotation: CubeAnnotationPreview }) {
  const hovered = face ? cubeAtDisplayPosition(state, face.cell) : undefined;
  return <group>{state.cubes.filter((cube) => cubeIsVisible(state, cube) && (cube.mark || cube.numberLabel || (hovered?.id === cube.id && (tool === "mark" || tool === "number")))).map((cube) => {
    const markPreview = tool === "mark" && hovered?.id === cube.id && face;
    const numberPreview = tool === "number" && hovered?.id === cube.id && !cube.numberLabel && face;
    const mark = markPreview ? { ...annotation, value: undefined, direction: markPreview.direction } : cube.mark;
    const numberLabel = numberPreview ? { ...annotation, shape: undefined, direction: numberPreview.direction } : cube.numberLabel;
    const paired = mark && numberLabel && mark.placement === numberLabel.placement && mark.direction === numberLabel.direction;
    return <group key={cube.id}>
      {mark && <Suspense fallback={null}><Annotation cube={cube} label={mark} lane={paired ? -1 : 0} preview={Boolean(markPreview)} /></Suspense>}
      {numberLabel && <Suspense fallback={null}><Annotation cube={cube} label={numberLabel} lane={paired ? 1 : 0} preview={Boolean(numberPreview)} /></Suspense>}
    </group>;
  })}</group>;
}
