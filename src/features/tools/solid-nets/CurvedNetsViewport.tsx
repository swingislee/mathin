"use client";

import { useCallback, useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import { THREE_SHADOWS } from "@/lib/three-runtime";
import { cubeWorkbenchCamera } from "../spatial-lab/cube-workbench-camera";
import { useSpatialParameterDrag } from "../spatial-interaction/useSpatialParameterDrag";
import { curvedPaperMesh, curvedPaperPoint, curvedParts, curvedNetFrame } from "./curved-model";
import type { CurvedNetSnapshot, CurvedPart } from "./curved-contract";

interface Props { snapshot: CurvedNetSnapshot; locale: "zh" | "en"; interactive: boolean; cameraInteractive?: boolean; dragging: boolean; tool: "fold" | "orbit" | "pan" | "select"; selected: CurvedPart | null; axisSnap: boolean; cameraKey: number;
  onSelect: (part: CurvedPart) => void; onPreview: (part: CurvedPart, value: number | null) => void; onCommit: (part: CurvedPart, value: number) => void; onDragging: (active: boolean) => void; onPointerMissed?: (event: MouseEvent) => void }
function Paper({ part, props }: { part: CurvedPart; props: Props }) {
  const { snapshot, selected, onSelect, tool } = props;
  const camera = useThree((s) => s.camera), canvas = useThree((s) => s.gl.domElement);
  const paper = useMemo(() => curvedPaperMesh(snapshot, part), [snapshot, part]);
  const geometry = useMemo(() => { const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(paper.positions, 3)); g.setAttribute("uv", new Float32BufferAttribute(paper.uv, 2)); g.computeVertexNormals(); return g; }, [paper]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const grab = useSpatialParameterDrag<CurvedPart>({ enabled: props.interactive && (tool === "fold" || tool === "orbit"), onPreview: props.onPreview, onCommit: props.onCommit, onDragging: props.onDragging });
  const names = props.locale === "zh" ? { side: "侧面", lower: "底面", upper: "另一底面" } : { side: "Side", lower: "Base", upper: "Other base" };
  const label = part === "side" ? `${names.side} · ${snapshot.kind === "cylinder" ? "2πr × h" : props.locale === "zh" ? "弧长 2πr" : "arc 2πr"}` : names[part];
  return <group>
    <mesh geometry={geometry} onPointerDown={(e) => {
      if (!props.interactive || tool === "pan") return;
      onSelect(part);
      if (tool === "select") { e.stopPropagation(); return; }
      const uv = e.uv ?? { x: 0.8, y: 0.75 }, rect = canvas.getBoundingClientRect();
      const u = part === "side" && Math.abs(uv.x - 0.5) < 0.18 ? uv.x < 0.5 ? 0.25 : 0.75 : uv.x;
      const v = part === "side" && snapshot.kind === "cone" ? Math.max(0.3, uv.y) : uv.y;
      grab(part, e, snapshot.progress[part], (value) => { const p = curvedPaperPoint(snapshot, part, u, v, value).project(camera); return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 }; });
    }}>
      <meshBasicMaterial side={DoubleSide} color={snapshot.surfaces[part].color} opacity={snapshot.surfaces[part].opacity} transparent depthWrite={false} polygonOffset polygonOffsetFactor={1} />
    </mesh>
    <Line points={paper.outline} lineWidth={selected === part ? 2.4 : 1.5} color={selected === part ? "#c89b45" : "#40433b"} raycast={() => null} />
    {paper.linkedEdges.map((edge, i) => <Line key={i} points={edge} color={part === "upper" || part === "side" && snapshot.kind === "cylinder" && i === 1 ? "#ca715f" : "#478aaa"} lineWidth={2} raycast={() => null} />)}
    {snapshot.labelsVisible && <Html center position={paper.label.toArray()} style={{ pointerEvents: "none" }} zIndexRange={[3, 0]}><span className="whitespace-nowrap rounded bg-paper/90 px-1 text-xs text-ink">{label}</span></Html>}
  </group>;
}
export function CurvedNetsViewport(props: Props) {
  const s = props.snapshot;
  const frame = useMemo(() => curvedNetFrame(s.kind, s.radius, s.height), [s.kind, s.radius, s.height]);
  const bookmark = useMemo(() => cubeWorkbenchCamera(frame, s.view, "curved-nets"), [frame, s.view]);
  const transition = useCallback(() => {}, []);
  return <Canvas className="!absolute !inset-0" dpr={[1, 1.5]} frameloop="demand" shadows={THREE_SHADOWS.disabled}
    gl={{ antialias: true, alpha: true }} style={{ touchAction: (props.cameraInteractive ?? props.interactive) ? "none" : "pan-x pan-y" }} onPointerMissed={props.interactive && !props.dragging ? props.onPointerMissed : undefined}
    fallback={<div className="grid h-full place-items-center text-sm text-muted">{props.locale === "zh" ? "请启用 WebGL 后重试。" : "Please enable WebGL."}</div>}>
    <SpatialCameraRig bookmark={bookmark} radius={frame.radius} requestKey={props.cameraKey} interactive={(props.cameraInteractive ?? props.interactive) && !props.dragging} navigationMode={props.tool === "pan" ? "pan" : "orbit"} axisSnapEnabled={props.axisSnap} onTransitionStateChange={transition} minDistance={0.1} maxDistance={200} />
    {curvedParts(s).map((part) => <Paper key={part} part={part} props={props} />)}
  </Canvas>;
}
