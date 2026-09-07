"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { DoubleSide, Vector3 } from "three";
import { Scissors, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VoxelCoordinate, VoxelFaceSelection } from "@/features/spatial-math/domain";
import { buildVoxelPaintFaceInstances } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import { adjacentCube, CUBE_AXIS_COLORS, type CubeStructureState, type CubeTool } from "./cube-structures-contract";
import { CubeStructureAnnotations, type CubeAnnotationPreview } from "./CubeStructureAnnotations";
import { cubeCutPreviewPlanes } from "./cube-structures-cut-preview";
import type { CubeCutLine, CubeCutSelection } from "./cube-structures-cut-interaction";

export function CubeStructuresScene({ state, cut, cutLines, cutConfirmation, annotation, tool, face, ground, origin, axesVisible, axisLength, validBuild, onGroundHover, onGroundClick }: {
  readonly state: CubeStructureState;
  readonly cut: CubeCutSelection | null;
  readonly cutLines: readonly CubeCutLine[];
  readonly cutConfirmation: { readonly anchor: VoxelCoordinate; readonly title: string; readonly confirmLabel: string; readonly cancelLabel: string; readonly disabled: boolean; readonly onConfirm: () => void; readonly onCancel: () => void } | null;
  readonly annotation: CubeAnnotationPreview;
  readonly tool: CubeTool;
  readonly face: VoxelFaceSelection | null;
  readonly ground: VoxelCoordinate | null;
  readonly origin: VoxelCoordinate | null;
  readonly axesVisible: boolean;
  readonly axisLength: number;
  readonly validBuild: boolean;
  readonly onGroundHover: (position: VoxelCoordinate | null) => void;
  readonly onGroundClick: (position: VoxelCoordinate) => void;
}) {
  const position = tool === "build" ? (face ? adjacentCube(face) : ground) : face?.cell;
  const highlightedFace = tool === "face" || tool === "cut" ? face : null;
  const previewFace = highlightedFace ? buildVoxelPaintFaceInstances([highlightedFace.cell], [highlightedFace])[0] : null;
  const color = tool === "cut" && cut ? CUBE_AXIS_COLORS[cut.axis] : tool === "remove" || (tool === "build" && !validBuild) ? "#df8a84" : "#edce79";
  const floor = origin?.y ?? -0.5;
  const groundPosition = (event: ThreeEvent<PointerEvent | MouseEvent>): VoxelCoordinate => ({ x: Math.round(event.point.x), y: floor + 0.5, z: Math.round(event.point.z) });
  return <>
    <CubeStructureAnnotations state={state} tool={tool} face={face} annotation={annotation} />
    {tool === "cut" && cut && cubeCutPreviewPlanes(state, cut.axis, cut.after, cut.ids).map((plane) => {
      const [a, b] = (["x", "y", "z"] as const).filter((axis) => axis !== cut.axis);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([first, second]) => {
        const point = { ...plane.center, [a]: plane.center[a] + first * plane.size[a] / 2, [b]: plane.center[b] + second * plane.size[b] / 2 };
        return [point.x, point.y, point.z] as [number, number, number];
      });
      return <group key={plane.key}><mesh position={[plane.center.x, plane.center.y, plane.center.z]} rotation={plane.rotation} raycast={() => null} renderOrder={5}>
        <planeGeometry args={plane.dimensions} />
        <meshBasicMaterial color={CUBE_AXIS_COLORS[cut.axis]} transparent opacity={0.12} depthWrite={false} side={DoubleSide} polygonOffset polygonOffsetFactor={-1} />
      </mesh><Line points={corners} color={CUBE_AXIS_COLORS[cut.axis]} lineWidth={1.5} dashed dashSize={0.12} gapSize={0.08} depthTest={false} depthWrite={false} raycast={() => null} renderOrder={6} /></group>;
    })}
    {/* Three 先按组顺序绘制；高亮组置于原粗棱边组之后，保持所选线清晰可见。 */}
    {["cut", "orbit", "pan"].includes(tool) && <group name="cube-cut-lines" renderOrder={7}>{[...new Map(cutLines.map((line) => [line.key, line])).values()].map((line, index) => <Line key={line.key}
      points={[[line.start.x, line.start.y, line.start.z], [line.end.x, line.end.y, line.end.z]]}
      color={cut ? CUBE_AXIS_COLORS[cut.axis] : "#edce79"} lineWidth={index === 0 ? 6 : 4} depthTest={false} depthWrite={false} raycast={() => null} renderOrder={7} />)}</group>}
    {tool === "cut" && cutConfirmation && <Html position={[cutConfirmation.anchor.x, cutConfirmation.anchor.y, cutConfirmation.anchor.z]} zIndexRange={[24, 20]}
      calculatePosition={(object, camera, size) => {
        const point = new Vector3().setFromMatrixPosition(object.matrixWorld).project(camera);
        return [Math.max(8, Math.min(size.width - 218, (point.x + 1) * size.width / 2 + 14)), Math.max(54, Math.min(size.height - 104, (1 - point.y) * size.height / 2))];
      }}>
      <div className="w-40 cursor-default rounded-lg border border-line bg-paper p-1.5 shadow-sm" data-cube-cut-confirmation onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") cutConfirmation.onCancel(); }}>
        <p className="mb-1 px-1 text-xs text-muted">{cutConfirmation.title}</p>
        <div className="flex items-center gap-1"><Button size="sm" className="h-8 gap-1 px-2 text-xs" disabled={cutConfirmation.disabled} onClick={cutConfirmation.onConfirm}><Scissors aria-hidden className="size-3.5" />{cutConfirmation.confirmLabel}</Button><Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={cutConfirmation.onCancel}><X aria-hidden className="size-3.5" />{cutConfirmation.cancelLabel}</Button></div>
      </div>
    </Html>}
    {axesVisible && origin && <group>
      {(["x", "y", "z"] as const).map((axis) => {
        const end = { ...origin, [axis]: origin[axis] + axisLength };
        return <group key={axis}>
          <Line points={[[origin.x, origin.y, origin.z], [end.x, end.y, end.z]]} color={CUBE_AXIS_COLORS[axis]} lineWidth={2} worldUnits={false} raycast={() => null} />
          <Html position={[end.x, end.y, end.z]} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
            <span className="rounded bg-paper/90 px-1 text-xs font-bold" style={{ color: CUBE_AXIS_COLORS[axis] }}>{axis.toUpperCase()}</span>
          </Html>
        </group>;
      })}
      <Html position={[origin.x, origin.y, origin.z]} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}><span className="rounded bg-paper/90 px-1 text-xs text-ink">0</span></Html>
    </group>}
    {tool === "build" && <>
      <gridHelper args={[25, 25, "#b8b0a3", "#d9d3c8"]} position={[0, floor - 0.003, 0]} raycast={() => null} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floor - 0.005, 0]}
        onPointerMove={(event) => { event.stopPropagation(); onGroundHover(groundPosition(event)); }}
        onPointerOut={() => onGroundHover(null)}
        onClick={(event) => { if (event.delta <= 5) { event.stopPropagation(); onGroundClick(groundPosition(event)); } }}>
        <planeGeometry args={[25, 25]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={DoubleSide} />
      </mesh>
    </>}
    {previewFace ? <mesh
      position={[previewFace.center.x, previewFace.center.y, previewFace.center.z]}
      rotation={[previewFace.rotation.x, previewFace.rotation.y, previewFace.rotation.z]}
      raycast={() => null} renderOrder={4}>
      <planeGeometry args={[1.01, 1.01]} />
      <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} side={DoubleSide} polygonOffset polygonOffsetFactor={-2} />
    </mesh> : position && !["orbit", "pan", "cut", "mark", "number"].includes(tool) && <mesh position={[position.x, position.y, position.z]} raycast={() => null}>
      <boxGeometry args={[1.04, 1.04, 1.04]} />
      <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
    </mesh>}
  </>;
}
