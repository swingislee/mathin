"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import { THREE_SHADOWS } from "@/lib/three-runtime";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import type { PolyhedronFoldRenderFace } from "@/features/spatial-math/renderer-r3f/polyhedron-fold-render-model";
import { CubeNetFoldInteraction } from "../spatial-lab/CubeNetFoldViewport";
import type { CubeNetFoldChange, CubeNetPaperSelection } from "../spatial-lab/cube-net-fold-drag";
import { resolvePaperFolding } from "./model";
import type { PaperFoldingSnapshot } from "./contract";
import { paperFoldingMessages } from "./messages";

function PaperFace({ face, outline, onSelect }: { face: PolyhedronFoldRenderFace; outline: string; onSelect?: (id: string) => void }) {
  const geometry = useMemo(() => {
    const value = new BufferGeometry(); value.setAttribute("position", new Float32BufferAttribute(face.trianglePositions, 3)); value.computeVertexNormals(); return value;
  }, [face.trianglePositions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const points = [...face.vertices, face.vertices[0]].map(({ position }) => [position.x, position.y, position.z] as [number, number, number]);
  return <group>
    <mesh geometry={geometry} onClick={onSelect ? (event) => { if (event.delta > 5) return; event.stopPropagation(); onSelect(face.faceId); } : undefined}>
      <meshBasicMaterial color={face.materialToken} side={DoubleSide} toneMapped={false} transparent opacity={0.88} depthWrite={false} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
    </mesh>
    <Line points={points} color={outline} lineWidth={2} raycast={() => null} />
    {face.label && <Html center position={[face.centroid.x, face.centroid.y + 0.015, face.centroid.z]} occlude zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
      <span className="rounded-full bg-paper/95 px-1.5 py-0.5 text-xs text-ink">{face.label}</span>
    </Html>}
  </group>;
}

export function PaperFoldingViewport({ snapshot, locale, tool, dragging, active, axisSnapEnabled, cameraRequestKey, interactive,
  onFoldStart, onPreview, onCommit, onDraggingChange, onFaceSelect, onPointerMissed }: {
  snapshot: PaperFoldingSnapshot; locale: "zh" | "en"; tool: "fold" | "orbit" | "pan" | "select"; dragging: boolean; active: CubeNetPaperSelection | null;
  axisSnapEnabled: boolean; cameraRequestKey: number; interactive: boolean;
  onFoldStart: (value: CubeNetPaperSelection) => void; onPreview: (value: CubeNetFoldChange | null) => void;
  onCommit: (value: CubeNetFoldChange) => void; onDraggingChange: (value: boolean) => void; onFaceSelect: (id: string) => void;
  onPointerMissed?: (event: MouseEvent) => void;
}) {
  const resolved = useMemo(() => resolvePaperFolding(snapshot, active?.movingFaceIds), [snapshot, active]);
  const [ink, setInk] = useState(snapshot.squares[0].color as string);
  useEffect(() => {
    const update = () => setInk(getComputedStyle(document.documentElement).getPropertyValue("--ink").trim());
    update(); const observer = new MutationObserver(update), media = window.matchMedia("(prefers-color-scheme: dark)");
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] }); media.addEventListener("change", update);
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);
  const cameraTransition = useCallback(() => {}, []);
  const m = paperFoldingMessages(locale), fallback = <div className="grid h-full place-items-center p-4 text-sm text-muted">{m.webgl}</div>;
  return <Canvas className="!absolute !inset-0" dpr={[1, 1.5]} frameloop="demand" shadows={THREE_SHADOWS.disabled} fallback={fallback}
    onPointerMissed={interactive && !dragging ? onPointerMissed : undefined}
    gl={{ antialias: true, alpha: true }} style={{ touchAction: interactive ? "none" : "pan-x pan-y" }} aria-label={m.title}>
    <SpatialCameraRig bookmark={resolved.model.camera} radius={resolved.frame.radius} interactive={interactive && !dragging}
      navigationMode={tool === "pan" ? "pan" : "orbit"} axisSnapEnabled={axisSnapEnabled} requestKey={cameraRequestKey}
      onTransitionStateChange={cameraTransition} minDistance={0.1} maxDistance={100} />
    {resolved.model.faces.map((face) => <PaperFace key={face.faceId} face={face} outline={ink} onSelect={interactive && tool === "select" ? onFaceSelect : undefined} />)}
    <CubeNetFoldInteraction model={resolved.model} hinges={resolved.hinges} activeEdgeId={active?.edgeId ?? null}
      tool={tool === "select" ? "orbit" : tool} foldingEnabled={interactive} onFoldStart={onFoldStart} onPreview={onPreview} onCommit={onCommit} onDraggingChange={onDraggingChange} />
  </Canvas>;
}
