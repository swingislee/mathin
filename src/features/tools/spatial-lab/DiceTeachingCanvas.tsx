"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { CanvasTexture, DoubleSide, FrontSide, Plane, SRGBColorSpace, Vector3 } from "three";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import type { CubeFrame, CubeView } from "./cube-structures-contract";
import { cubeWorkbenchCamera } from "./cube-workbench-camera";
import { CubeNetFaceArrows } from "./CubeNetFaceArrows";
import { DICE_BOARD_LIMIT, DICE_FACES, FACE_NORMALS, PIP_POINTS, faceValue, quaternion, vector, worldNormal, type DiceFace, type DiceVector, type DiceFootprint, type TeachingDie } from "./dice-teaching-model";
import { diceFaceGeometries, DICE_UV_LENGTH } from "./dice-teaching-geometry";
import { diceTeachingMessages } from "./dice-teaching-messages";

function pipTextures(value: number) {
  const paint = (bump: boolean) => {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = bump ? "#eeeeee" : "#fffefd"; ctx.fillRect(0, 0, 256, 256);
    for (const [x, y] of PIP_POINTS[value]) {
      const px = (0.5 + x / DICE_UV_LENGTH) * 256, py = (0.5 - y / DICE_UV_LENGTH) * 256;
      const gradient = ctx.createRadialGradient(px - 1, py + 1, 1, px, py, 17);
      gradient.addColorStop(0, bump ? "#323232" : "#151719"); gradient.addColorStop(0.72, bump ? "#555555" : "#26292c"); gradient.addColorStop(1, bump ? "#eeeeee" : "#55585a");
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(px, py, 17, 0, Math.PI * 2); ctx.fill();
    }
    const texture = new CanvasTexture(canvas); if (!bump) texture.colorSpace = SRGBColorSpace;
    return texture;
  };
  return { map: paint(false), bump: paint(true) };
}

interface DiceCanvasProps {
  dice: readonly TeachingDie[]; trail: readonly DiceFootprint[]; selectedId: string; locale: string;
  tool: "orbit" | "pan" | "move" | "pips"; arrows: boolean; busy: boolean; grid: boolean; axes: boolean; floor: boolean;
  frame: CubeFrame; view: CubeView | "bottom"; cameraKey: number;
  onSelect: (id: string) => void; onFace: (id: string, face: DiceFace) => void; onMoveFace: (face: DiceFace) => void; onPlace: (id: string, position: DiceVector) => void;
}
class DiceCanvasBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert" className="p-8 text-sm">{this.props.label}</p> : this.props.children; }
}
function DiceObjects(props: DiceCanvasProps) {
  const { dice, selectedId, locale } = props;
  const m = diceTeachingMessages(locale);
  const geometries = useMemo(() => diceFaceGeometries(), []);
  const textures = useMemo(() => Array.from({ length: 7 }, (_, value) => pipTextures(value)), []);
  const drag = useRef<{ id: string; plane: Plane; offset: Vector3; pointerId: number; target: { releasePointerCapture: (id: number) => void } } | null>(null);
  const [preview, setPreview] = useState<{ id: string; position: Vector3 } | null>(null);
  useEffect(() => () => { geometries.forEach((g) => g.dispose()); textures.forEach((t) => { t.map.dispose(); t.bump.dispose(); }); }, [geometries, textures]);
  useEffect(() => {
    const cancel = () => { if (drag.current) { try { drag.current.target.releasePointerCapture(drag.current.pointerId); } catch { /* 捕获已由浏览器释放。 */ } } drag.current = null; setPreview(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("blur", cancel); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("keydown", key); cancel(); };
  }, []);
  const selected = dice.find((die) => die.id === selectedId);
  const arrows = selected ? DICE_FACES.map((face) => {
    const normal = worldNormal(selected, face), offset = selected.offsets[face] ?? 0;
    const center = vector(selected.position).addScaledVector(normal, 0.5 + offset);
    return { faceId: face, label: `${m.die} ${selected.id.replace("dice-", "")}`, normal, translation: normal.clone().multiplyScalar(offset), center, position: center.clone().addScaledVector(normal, 0.9), expanded: offset > 0, direction: normal.clone().multiplyScalar(offset > 0 ? -1 : 1) };
  }) : [];
  const down = (event: ThreeEvent<PointerEvent>, die: TeachingDie) => {
    if (props.busy || props.tool !== "move" || event.button !== 0) return;
    event.stopPropagation(); props.onSelect(die.id);
    const plane = new Plane(new Vector3(0, 1, 0), -die.position.y), point = event.ray.intersectPlane(plane, new Vector3());
    if (!point) return;
    const target = event.target as typeof event.target & { setPointerCapture: (id: number) => void; releasePointerCapture: (id: number) => void };
    target.setPointerCapture(event.pointerId);
    drag.current = { id: die.id, plane, offset: vector(die.position).sub(point), pointerId: event.pointerId, target };
    setPreview({ id: die.id, position: vector(die.position) });
  };
  const move = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    event.stopPropagation(); const point = event.ray.intersectPlane(drag.current.plane, new Vector3());
    if (point) setPreview({ id: drag.current.id, position: point.add(drag.current.offset) });
  };
  const up = (event: ThreeEvent<PointerEvent>) => {
    const active = drag.current; if (!active) return;
    event.stopPropagation(); const point = event.ray.intersectPlane(active.plane, new Vector3());
    drag.current = null; setPreview(null); active.target.releasePointerCapture(active.pointerId);
    if (point) { point.add(active.offset); props.onPlace(active.id, { x: Math.round(point.x), y: Math.round(point.y - 0.5) + 0.5, z: Math.round(point.z) }); }
  };
  const baseCamera = cubeWorkbenchCamera(props.frame, props.view === "bottom" ? "top" : props.view, "dice");
  const camera = props.view === "bottom" ? { ...baseCamera, position: { ...props.frame.center, y: props.frame.center.y - props.frame.radius * 4 }, up: { x: 0, y: 0, z: 1 } } : baseCamera;
  return <>
    <SpatialCameraRig bookmark={camera} radius={props.frame.radius} requestKey={props.cameraKey} interactive={!preview} navigationMode={props.tool === "pan" ? "pan" : "orbit"} onTransitionStateChange={() => {}} />
    <ambientLight intensity={1.35} /><hemisphereLight args={["#ffffff", "#8f9aa5", 1.4]} />
    <directionalLight position={[4, 9, 5]} intensity={3} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-bias={-0.0005} />
    <directionalLight position={[-5, -3, -5]} intensity={1.6} />
    {props.floor && <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[DICE_BOARD_LIMIT * 2, DICE_BOARD_LIMIT * 2]} /><meshStandardMaterial color="#eceae4" roughness={0.9} side={FrontSide} /></mesh>
      {[-1, 1].flatMap((sign) => ([
        <mesh key={`x${sign}`} position={[sign * DICE_BOARD_LIMIT, 0.3, 0]}><boxGeometry args={[0.3, 0.6, DICE_BOARD_LIMIT * 2]} /><meshStandardMaterial color="#dbd6cb" /></mesh>,
        <mesh key={`z${sign}`} position={[0, 0.3, sign * DICE_BOARD_LIMIT]}><boxGeometry args={[DICE_BOARD_LIMIT * 2, 0.6, 0.3]} /><meshStandardMaterial color="#dbd6cb" /></mesh>,
      ]))}
    </group>}
    {props.grid && <gridHelper args={[DICE_BOARD_LIMIT * 2, DICE_BOARD_LIMIT * 2, "#b6c0c7", "#d5d8d8"]} position={[0, 0.003, 0]} />}
    {props.axes && <group><axesHelper args={[2.6]} /><Html position={[2.8, 0, 0]} center><span className="text-xs text-red-600">X</span></Html><Html position={[0, 0, 2.8]} center><span className="text-xs text-blue-600">Z</span></Html><Html position={[0, 2.8, 0]} center><span className="text-xs text-green-700">Y</span></Html></group>}
    {props.trail.flatMap((stamp, index) => stamp.points.map((point, pip) => <mesh key={`${index}:${pip}`} position={[point.x, point.y, point.z]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.065, 16]} /><meshBasicMaterial color="#606c7b" side={DoubleSide} /></mesh>))}
    {dice.map((die) => <group key={die.id} position={preview?.id === die.id ? preview.position : vector(die.position)} quaternion={quaternion(die.rotation)}>
      {DICE_FACES.map((face, index) => {
        const texture = textures[die.hidden.includes(face) ? 0 : faceValue(die.hand, face)];
        return <mesh key={face} geometry={geometries[index]} position={vector(FACE_NORMALS[face]).multiplyScalar(die.offsets[face] ?? 0)} castShadow receiveShadow
          onPointerDown={(event) => down(event, die)} onPointerMove={move} onPointerUp={up}
          onClick={(event) => { if (props.busy || event.delta > 3) return; event.stopPropagation(); props.onSelect(die.id); if (props.tool === "pips") props.onFace(die.id, face); }}>
          <meshPhysicalMaterial color="#ffffff" map={texture.map} bumpMap={texture.bump} bumpScale={0.027} roughness={0.28} clearcoat={0.35} clearcoatRoughness={0.25} side={DoubleSide} />
        </mesh>;
      })}
      {die.id === selectedId && !props.busy && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.497, 0]}><ringGeometry args={[0.65, 0.68, 48]} /><meshBasicMaterial color="#c28c46" side={DoubleSide} transparent opacity={0.65} depthWrite={false} /></mesh>}
    </group>)}
    {props.arrows && !props.busy && !preview && <CubeNetFaceArrows faces={arrows} onMove={(face) => props.onMoveFace(face as DiceFace)} />}
  </>;
}
export default function DiceTeachingCanvas(props: DiceCanvasProps) {
  const m = diceTeachingMessages(props.locale);
  return <DiceCanvasBoundary label={m.fallback}><Canvas frameloop="demand" shadows dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} fallback={<p>{m.fallback}</p>} style={{ touchAction: "none" }}>
    <DiceObjects {...props} />
  </Canvas></DiceCanvasBoundary>;
}
