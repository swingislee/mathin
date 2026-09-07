"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { Edges } from "@react-three/drei";
import { DoubleSide } from "three";
import type { VoxelCoordinate, VoxelFaceSelection } from "@/features/spatial-math/domain";
import { buildVoxelPaintFaceInstances } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import { adjacentCube, type CubeTool } from "./cube-structures-contract";

export function CubeStructuresScene({ tool, face, ground, selectedPositions, validBuild, onGroundHover, onGroundClick }: {
  readonly tool: CubeTool;
  readonly face: VoxelFaceSelection | null;
  readonly ground: VoxelCoordinate | null;
  readonly selectedPositions: readonly VoxelCoordinate[];
  readonly validBuild: boolean;
  readonly onGroundHover: (position: VoxelCoordinate | null) => void;
  readonly onGroundClick: (position: VoxelCoordinate) => void;
}) {
  const position = tool === "build" ? (face ? adjacentCube(face) : ground) : face?.cell;
  const previewFace = face && tool === "face" ? buildVoxelPaintFaceInstances([face.cell], [face])[0] : null;
  const color = tool === "remove" || (tool === "build" && !validBuild) ? "#df8a84" : "#edce79";
  const groundPosition = (event: ThreeEvent<PointerEvent | MouseEvent>): VoxelCoordinate => ({ x: Math.round(event.point.x), y: 0, z: Math.round(event.point.z) });
  return <>
    {selectedPositions.map((position) => <mesh key={`${position.x},${position.y},${position.z}`} position={[position.x, position.y, position.z]} raycast={() => null}>
      <boxGeometry args={[1.065, 1.065, 1.065]} />
      <meshBasicMaterial visible={false} />
      <Edges color="#b08024" raycast={() => null} />
    </mesh>)}
    {tool === "build" && <>
      <gridHelper args={[25, 25, "#b8b0a3", "#d9d3c8"]} position={[0, -0.503, 0]} raycast={() => null} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.505, 0]}
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
    </mesh> : position && tool !== "orbit" && <mesh position={[position.x, position.y, position.z]} raycast={() => null}>
      <boxGeometry args={[1.04, 1.04, 1.04]} />
      <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
    </mesh>}
  </>;
}
