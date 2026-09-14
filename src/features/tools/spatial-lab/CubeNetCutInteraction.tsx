"use client";

import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Quaternion, Vector3 } from "three";
import type { PolyhedronFoldRenderFace, PolyhedronFoldRenderModel } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { CUBE_SELECTION_COLOR } from "./cube-structures-contract";
import type { CubeNetCutEdge } from "./cube-net-cutting";

function CutOccluder({ face }: { readonly face: PolyhedronFoldRenderFace }) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(face.trianglePositions, 3));
    return result;
  }, [face.trianglePositions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} userData={{ cubeNetCutOccluder: face.faceId }} onClick={(event) => event.stopPropagation()} onPointerOver={(event) => event.stopPropagation()}>
    <meshBasicMaterial side={DoubleSide} colorWrite={false} depthWrite={false} />
  </mesh>;
}

function CutEdge({ edge, onToggle }: { readonly edge: CubeNetCutEdge; readonly onToggle?: (edgeId: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const placement = useMemo(() => {
    const start = new Vector3(edge.start.x, edge.start.y, edge.start.z), end = new Vector3(edge.end.x, edge.end.y, edge.end.z);
    return { center: start.clone().add(end).multiplyScalar(0.5), length: start.distanceTo(end),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), end.sub(start).normalize()) };
  }, [edge.start, edge.end]);
  return <group>
    {(edge.cut || (hovered && onToggle)) && <group position={placement.center} quaternion={placement.quaternion}>
      {(edge.cut ? Array.from({ length: 8 }, (_, index) => index) : [0]).map((index) => <mesh key={index}
        position={[0, edge.cut ? (index / 8 - 0.5 + 1 / 16) * placement.length : 0, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.029, 0.029, placement.length * (edge.cut ? 0.07 : 1), 8]} />
        <meshBasicMaterial color={CUBE_SELECTION_COLOR} />
      </mesh>)}
    </group>}
    {onToggle && <mesh position={placement.center} quaternion={placement.quaternion} userData={{ cubeNetCutEdge: edge.edgeId }}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation();
        // 单击剪棱；从棱上拖动仍交给相机，松手不会误剪。
        if (event.button === 0 && event.delta <= 5) onToggle(edge.edgeId);
      }}>
      <cylinderGeometry args={[0.055, 0.055, placement.length, 8]} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </mesh>}
  </group>;
}

export function CubeNetCutInteraction({ model, edges, onToggle }: {
  readonly model: PolyhedronFoldRenderModel;
  readonly edges: readonly CubeNetCutEdge[];
  readonly onToggle?: (edgeId: string) => void;
}) {
  return <>
    {onToggle && model.faces.map((face) => <CutOccluder key={face.faceId} face={face} />)}
    {edges.map((edge) => <CutEdge key={edge.edgeId} edge={edge} onToggle={onToggle} />)}
  </>;
}
