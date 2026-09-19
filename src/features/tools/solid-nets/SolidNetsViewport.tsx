"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import { THREE_SHADOWS } from "@/lib/three-runtime";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import type { PolyhedronFoldRenderFace } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { CubeNetFoldInteraction } from "../spatial-lab/CubeNetFoldViewport";
import { CUBE_COLORS, CUBE_SELECTION_COLOR, cubeGroupOutlineColor } from "../spatial-lab/cube-structures-contract";
import type { CubeNetFoldChange, CubeNetPaperSelection } from "../spatial-lab/cube-net-fold-drag";
import type { SolidNetsSnapshot } from "./contract";
import { resolveSolidNet } from "./model";
import { solidNetsMessages } from "./messages";

function Face({ face, outline, onSelect }: { face: PolyhedronFoldRenderFace; outline: string; onSelect?: (id: string) => void }) {
  const geometry = useMemo(() => {
    const result = new BufferGeometry(); result.setAttribute("position", new Float32BufferAttribute(face.trianglePositions, 3)); result.computeVertexNormals(); return result;
  }, [face.trianglePositions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <group>
    <mesh geometry={geometry} onClick={onSelect ? (event) => { if (event.delta > 5) return; event.stopPropagation(); onSelect(face.faceId); } : undefined}>
      <meshBasicMaterial color={face.materialToken} side={DoubleSide} toneMapped={false} transparent opacity={face.opacity ?? 0.9} depthWrite={false} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
    </mesh>
    <Line points={[...face.vertices, face.vertices[0]].map(({ position: p }) => [p.x, p.y, p.z])}
      color={face.selected ? CUBE_SELECTION_COLOR : outline} lineWidth={face.selected ? 3 : 2} raycast={() => null} />
    {face.label && <Html center position={[face.centroid.x, face.centroid.y + 0.015, face.centroid.z]} occlude zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
      <span className="rounded-full bg-paper/95 px-1.5 py-0.5 text-xs text-ink">{face.label}</span>
    </Html>}
  </group>;
}

export interface SolidNetsViewportProps {
  snapshot: SolidNetsSnapshot; locale: "zh" | "en"; tool: "fold" | "orbit" | "pan" | "select"; dragging: boolean;
  active: CubeNetPaperSelection | null; selected: string | null; axisSnapEnabled: boolean; cameraRequestKey: number; interactive: boolean;
  onFoldStart: (value: CubeNetPaperSelection) => void; onPreview: (value: CubeNetFoldChange | null) => void;
  onCommit: (value: CubeNetFoldChange) => void; onDraggingChange: (value: boolean) => void; onFaceSelect: (id: string) => void;
}
export function SolidNetsViewport({ snapshot, locale, tool, dragging, active, selected, axisSnapEnabled, cameraRequestKey, interactive,
  onFoldStart, onPreview, onCommit, onDraggingChange, onFaceSelect }: SolidNetsViewportProps) {
  const resolved = useMemo(() => resolveSolidNet(snapshot, active?.movingFaceIds ?? (tool === "select" && selected ? [selected] : [])), [snapshot, active, tool, selected]);
  const [ink, setInk] = useState(cubeGroupOutlineColor(CUBE_COLORS[5]));
  useEffect(() => {
    const update = () => setInk(getComputedStyle(document.documentElement).getPropertyValue("--ink").trim());
    update(); const observer = new MutationObserver(update), media = window.matchMedia("(prefers-color-scheme: dark)");
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] }); media.addEventListener("change", update);
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);
  const transition = useCallback(() => {}, []), m = solidNetsMessages(locale);
  return <Canvas className="!absolute !inset-0" dpr={[1, 1.5]} frameloop="demand" shadows={THREE_SHADOWS.disabled}
    fallback={<div className="grid h-full place-items-center p-4 text-sm text-muted">{m.webgl}</div>}
    gl={{ antialias: true, alpha: true }} style={{ touchAction: interactive ? "none" : "pan-x pan-y" }} aria-label={m.title}>
    <SpatialCameraRig bookmark={resolved.model.camera} radius={resolved.frame.radius} interactive={interactive && !dragging}
      navigationMode={tool === "pan" ? "pan" : "orbit"} axisSnapEnabled={axisSnapEnabled} requestKey={cameraRequestKey}
      onTransitionStateChange={transition} minDistance={0.1} maxDistance={200} />
    {resolved.model.faces.map((face) => <Face key={face.faceId} face={face} outline={ink} onSelect={interactive && tool === "select" ? onFaceSelect : undefined} />)}
    <CubeNetFoldInteraction model={resolved.model} hinges={resolved.hinges} activeEdgeId={active?.edgeId ?? null}
      tool={tool === "select" ? "orbit" : tool} foldingEnabled={interactive} onFoldStart={onFoldStart} onPreview={onPreview} onCommit={onCommit} onDraggingChange={onDraggingChange} />
  </Canvas>;
}
