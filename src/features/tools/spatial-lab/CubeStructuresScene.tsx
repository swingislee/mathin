"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { DoubleSide } from "three";
import type { Axis, VoxelCoordinate, VoxelFaceSelection } from "@/features/spatial-math/domain";
import { buildVoxelPaintFaceInstances } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import { adjacentCube, CUBE_AXIS_COLORS, type CubeStructureState, type CubeTool } from "./cube-structures-contract";
import { CubeStructureAnnotations, type CubeAnnotationPreview } from "./CubeStructureAnnotations";
import { cubeCutPreviewPlanes } from "./cube-structures-cut-preview";

export function CubeStructuresScene({ state, cut, annotation, tool, face, ground, origin, axesVisible, axisLength, validBuild, onGroundHover, onGroundClick }: {
  readonly state: CubeStructureState;
  readonly cut: { readonly axis: Axis; readonly after: number; readonly ids: readonly string[] } | null;
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
  const previewFace = face && tool === "face" ? buildVoxelPaintFaceInstances([face.cell], [face])[0] : null;
  const color = tool === "remove" || (tool === "build" && !validBuild) ? "#df8a84" : "#edce79";
  const floor = origin?.y ?? -0.5;
  const groundPosition = (event: ThreeEvent<PointerEvent | MouseEvent>): VoxelCoordinate => ({ x: Math.round(event.point.x), y: floor + 0.5, z: Math.round(event.point.z) });
  return <>
    <CubeStructureAnnotations state={state} tool={tool} face={face} annotation={annotation} />
    {tool === "cut" && cut && cubeCutPreviewPlanes(state, cut.axis, cut.after, cut.ids).map((plane) => <mesh key={plane.key} position={[plane.center.x, plane.center.y, plane.center.z]} raycast={() => null} renderOrder={5}>
      <boxGeometry args={[plane.size.x, plane.size.y, plane.size.z]} />
      <meshBasicMaterial color={CUBE_AXIS_COLORS[cut.axis]} transparent opacity={0.22} depthTest={false} depthWrite={false} side={DoubleSide} />
    </mesh>)}
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
