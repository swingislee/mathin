"use client";

import { Component, useEffect, useMemo, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import { THREE_SHADOWS } from "@/lib/three-runtime";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import { CUBE_AXIS_COLORS, CUBE_COLORS, cubeGroupOutlineColor } from "../spatial-lab/cube-structures-contract";
import { cubeWorkbenchCamera } from "../spatial-lab/cube-workbench-camera";
import type { SolidRevolutionSnapshot } from "./contract";
import { revolutionDimensions, revolutionPoint, revolutionProfile, revolutionSweepPositions, revolutionTrianglePositions } from "./model";
import { solidRevolutionMessages } from "./messages";
import { RevolutionInteraction } from "./RevolutionInteraction";

const ignoreRaycast = () => null;
const noop = () => {};
const paperOutline = cubeGroupOutlineColor(CUBE_COLORS[2]);
function Surface({ positions, color, opacity, paper = false }: { positions: number[]; color: string; opacity: number; paper?: boolean }) {
  const geometry = useMemo(() => {
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals(); return geometry;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} userData={paper ? { spatialObjectId: "revolution-paper" } : undefined} raycast={paper ? undefined : ignoreRaycast} renderOrder={paper ? 3 : 1}>
    <meshBasicMaterial color={color} transparent opacity={opacity} side={DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={paper ? -2 : 1} polygonOffsetUnits={1} />
  </mesh>;
}
export interface SolidRevolutionCanvasProps {
  snapshot: SolidRevolutionSnapshot; angle: number; locale: "zh" | "en"; navigation: "orbit" | "pan"; axisSnap: boolean;
  interactive: boolean; gestureEnabled: boolean; selected: boolean;
  onSelect: () => void; onPreview: (angle: number | null) => void; onCommit: (angle: number) => boolean; onDragging: (value: boolean) => void;
  onUnavailable: () => void;
  onPointerMissed?: (event: MouseEvent) => void;
}
function Contents(props: SolidRevolutionCanvasProps) {
  const { snapshot, angle, locale } = props, m = solidRevolutionMessages(locale);
  const dimensions = revolutionDimensions(snapshot), { radius, height } = dimensions;
  const frame = useMemo(() => ({ center: { x: 0, y: height / 2, z: 0 }, radius: Math.hypot(radius, height / 2) * 1.1 }), [radius, height]);
  const bookmark = cubeWorkbenchCamera(frame, snapshot.view === "bottom" ? "top" : snapshot.view, "solid-revolution");
  const camera = snapshot.view === "bottom" ? { ...bookmark, position: { x: 0, y: -frame.radius * 4, z: 0 }, up: { x: 0, y: 0, z: 1 } } : bookmark;
  const profile = useMemo(() => revolutionProfile(snapshot, angle), [snapshot, angle]);
  const paper = useMemo(() => revolutionTrianglePositions(profile), [profile]);
  const sweep = useMemo(() => revolutionSweepPositions(snapshot, angle), [snapshot, angle]);
  const start = useMemo(() => revolutionProfile(snapshot), [snapshot]);
  const startPositions = useMemo(() => revolutionTrianglePositions(start), [start]);
  const points = (source: typeof profile) => source.map((p) => [p.x, p.y, p.z] as [number, number, number]);
  const current = revolutionPoint(radius, 0, angle);
  const arc = Array.from({ length: 121 }, (_, index) => revolutionPoint(radius, 0.006, angle * index / 120));
  return <>
    <SpatialCameraRig bookmark={camera} radius={frame.radius} requestKey={snapshot.cameraRevision} interactive={props.interactive}
      navigationMode={props.navigation} axisSnapEnabled={props.axisSnap} onTransitionStateChange={noop} />
    {snapshot.grid && <gridHelper args={[Math.max(12, Math.ceil(radius * 3)), Math.max(12, Math.ceil(radius * 3)), CUBE_COLORS[5], CUBE_COLORS[5]]} raycast={ignoreRaycast} />}
    {snapshot.axes && <axesHelper args={[Math.max(radius, height) + 0.8]} raycast={ignoreRaycast} />}
    {snapshot.showSweep && angle > 0 && <Surface positions={sweep} color={CUBE_COLORS[3]} opacity={0.32} />}
    {snapshot.showStart && angle > 0.5 && angle < 359.5 && <>
      <Surface positions={startPositions} color={CUBE_COLORS[5]} opacity={0.09} />
      <Line points={points([...start, start[0]])} color={cubeGroupOutlineColor(CUBE_COLORS[5])} lineWidth={1} dashed dashSize={0.09} gapSize={0.05} raycast={ignoreRaycast} />
    </>}
    <Surface positions={paper} color={CUBE_COLORS[2]} opacity={0.9} paper />
    <Line points={points([...profile, profile[0]])} color={paperOutline} lineWidth={props.selected ? 2.5 : 2} raycast={ignoreRaycast} />
    <Line points={[[0, -0.25, 0], [0, height + 0.45, 0]]} color={CUBE_AXIS_COLORS.y} lineWidth={3} raycast={ignoreRaycast} />
    {angle > 0 && <Line points={points(arc)} color={paperOutline} lineWidth={2} raycast={ignoreRaycast} />}
    <mesh position={[current.x, current.y, current.z]} raycast={ignoreRaycast}><sphereGeometry args={[Math.min(radius, height) * 0.027, 16, 10]} /><meshBasicMaterial color={paperOutline} /></mesh>
    <Html position={[current.x, height * 0.45, current.z]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
      <span className="rounded bg-paper/90 px-1 text-xs text-ink">{Math.round(angle)}°</span>
    </Html>
    {snapshot.showMeasures && <>
      <Html position={[0, height + 0.6, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}><span className="whitespace-nowrap rounded bg-paper/95 px-1 text-xs text-ink">{snapshot.axis === "height" ? m.axisHeight : m.axisWidth} · {height}</span></Html>
      <Html position={[current.x / 2, -0.16, current.z / 2]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}><span className="whitespace-nowrap rounded bg-paper/95 px-1 text-xs text-ink">{m.radius} {radius}</span></Html>
    </>}
    <RevolutionInteraction {...props} />
  </>;
}
class Boundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert" className="p-8 text-sm">{this.props.label}</p> : this.props.children; }
}
export function SolidRevolutionCanvas(props: SolidRevolutionCanvasProps) {
  const m = solidRevolutionMessages(props.locale);
  return <Boundary label={m.fallback}><Canvas className="!absolute !inset-0" frameloop="demand" dpr={[1, 1.5]} shadows={THREE_SHADOWS.disabled}
    onPointerMissed={props.interactive ? props.onPointerMissed : undefined} gl={{ antialias: true, alpha: true }} style={{ touchAction: "none" }}
    fallback={<p className="p-8 text-sm">{m.fallback}</p>} aria-label={m.title}><Contents {...props} /></Canvas></Boundary>;
}
