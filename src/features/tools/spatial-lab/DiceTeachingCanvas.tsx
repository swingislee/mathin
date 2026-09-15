"use client";

import { Component, createRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { CanvasTexture, DoubleSide, FrontSide, Plane, SRGBColorSpace, Vector3, type Mesh } from "three";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import type { CubeFrame, CubeView } from "./cube-structures-contract";
import { cubeWorkbenchCamera } from "./cube-workbench-camera";
import { CubeNetFaceArrows } from "./CubeNetFaceArrows";
import { DICE_BOARD_LIMIT, DICE_FACES, PIP_POINTS, diceFaceTranslation, faceValue, isDiceFaceMoved, quaternion, vector, worldNormal, type DiceFace, type DiceVector, type DiceFootprint, type TeachingDie } from "./dice-teaching-model";
import { DICE_WHITE, diceFaceArrows, dicePipShades, diceSelectionMarker, diceSurface, ignoreDiceHelperRaycast } from "./dice-teaching-display";
import { diceFaceGeometries, DICE_UV_LENGTH } from "./dice-teaching-geometry";
import { diceTeachingMessages } from "./dice-teaching-messages";
import { diceFaceCorners, planDiceFaceObservations, type DiceObservationApi } from "./dice-face-observation";

function pipTextures(value: number, color: string) {
  const paint = (bump: boolean) => {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = bump ? "#eeeeee" : color; ctx.fillRect(0, 0, 256, 256);
    for (const [x, y] of PIP_POINTS[value]) {
      const px = (0.5 + x / DICE_UV_LENGTH) * 256, py = (0.5 - y / DICE_UV_LENGTH) * 256;
      const gradient = ctx.createRadialGradient(px - 1, py + 1, 1, px, py, 17);
      const shades = dicePipShades(value);
      gradient.addColorStop(0, bump ? "#323232" : shades[0]); gradient.addColorStop(0.72, bump ? "#555555" : shades[1]); gradient.addColorStop(1, bump ? "#eeeeee" : shades[2]);
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(px, py, 17, 0, Math.PI * 2); ctx.fill();
    }
    const texture = new CanvasTexture(canvas); if (!bump) texture.colorSpace = SRGBColorSpace;
    return texture;
  };
  return { map: paint(false), bump: paint(true) };
}

interface DiceCanvasProps {
  dice: readonly TeachingDie[]; trail: readonly DiceFootprint[]; selectedId: string; locale: string;
  tool: "orbit" | "pan" | "move" | "pips" | "color" | "transparent" | "inspect"; arrows: boolean; busy: boolean; grid: boolean; axes: boolean; floor: boolean;
  frame: CubeFrame; view: CubeView | "bottom"; cameraKey: number;
  observationRef: Ref<DiceObservationApi>;
  onSelect: (id: string) => void; onFace: (id: string, face: DiceFace) => void; onMoveFace: (id: string, face: DiceFace) => void; onPlace: (id: string, position: DiceVector) => void;
}
class DiceCanvasBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert" className="p-8 text-sm">{this.props.label}</p> : this.props.children; }
}
function DiceObjects(props: DiceCanvasProps) {
  const { dice, selectedId, locale } = props;
  const m = diceTeachingMessages(locale);
  const getThree = useThree((state) => state.get);
  useImperativeHandle(props.observationRef, () => ({ plan: (items, id, faces) => {
    const { camera, gl, size } = getThree();
    const rect = gl.domElement.getBoundingClientRect(), stage = gl.domElement.closest("[data-dice-stage]");
    const obstacles = [...(stage?.querySelectorAll("[data-dice-overlay], [data-cube-canvas-panel], [role='toolbar']") ?? [])].map((element) => {
      const area = element.getBoundingClientRect();
      return { left: area.left - rect.left, right: area.right - rect.left, top: area.top - rect.top, bottom: area.bottom - rect.top };
    });
    return planDiceFaceObservations(items, id, faces, { camera: camera.clone(), width: size.width, height: size.height, obstacles, floor: props.floor });
  } }), [getThree, props.floor]);
  const geometries = useMemo(() => diceFaceGeometries(), []);
  const colorKey = [...new Set([DICE_WHITE, ...dice.flatMap((die) => DICE_FACES.map((face) => diceSurface(die, face).color))])].sort().join("|");
  const textures = useMemo(() => new Map(colorKey.split("|").map((color) => [color, Array.from({ length: 7 }, (_, value) => pipTextures(value, color))])), [colorKey]);
  const diceIds = dice.map((die) => die.id).join(",");
  const faceRefs = useMemo(() => new Map<string, RefObject<Mesh>>(diceIds.split(",").flatMap((id) => DICE_FACES.map((face) => [`${id}/${face}`, createRef<Mesh>() as RefObject<Mesh>] as const))), [diceIds]);
  const opaqueFaceIds = dice.flatMap((die) => DICE_FACES.filter((face) => diceSurface(die, face).opacity >= 0.99).map((face) => `${die.id}/${face}`));
  const occluders = opaqueFaceIds.map((id) => faceRefs.get(id)!);
  const occlusionKey = opaqueFaceIds.join("|");
  const drag = useRef<{ id: string; plane: Plane; offset: Vector3; pointerId: number; target: { releasePointerCapture: (id: number) => void } } | null>(null);
  const [preview, setPreview] = useState<{ id: string; position: Vector3 } | null>(null);
  useEffect(() => () => { geometries.forEach((g) => g.dispose()); }, [geometries]);
  useEffect(() => () => { textures.forEach((palette) => palette.forEach((t) => { t.map.dispose(); t.bump.dispose(); })); }, [textures]);
  useEffect(() => {
    const cancel = () => { if (drag.current) { try { drag.current.target.releasePointerCapture(drag.current.pointerId); } catch { /* 捕获已由浏览器释放。 */ } } drag.current = null; setPreview(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("blur", cancel); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("keydown", key); cancel(); };
  }, []);
  const arrows = diceFaceArrows(dice, selectedId, (die, face) => `${m.die} ${die.id.replace("dice-", "")} · ${m.faces[face]}`);
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
    {props.grid && <gridHelper raycast={ignoreDiceHelperRaycast} args={[DICE_BOARD_LIMIT * 2, DICE_BOARD_LIMIT * 2, "#b6c0c7", "#d5d8d8"]} position={[0, 0.003, 0]} />}
    {props.axes && <group><axesHelper raycast={ignoreDiceHelperRaycast} args={[2.6]} /><Html position={[2.8, 0, 0]} center><span className="text-xs text-red-600">X</span></Html><Html position={[0, 0, 2.8]} center><span className="text-xs text-blue-600">Z</span></Html><Html position={[0, 2.8, 0]} center><span className="text-xs text-green-700">Y</span></Html></group>}
    {props.trail.flatMap((stamp, index) => stamp.points.map((point, pip) => <mesh raycast={ignoreDiceHelperRaycast} key={`${index}:${pip}`} position={[point.x, point.y, point.z]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.065, 16]} /><meshBasicMaterial color={dicePipShades(stamp.value)[1]} side={DoubleSide} /></mesh>))}
    <group>{dice.map((die) => <group key={die.id} position={preview?.id === die.id ? preview.position : vector(die.position)} quaternion={quaternion(die.rotation)}>
      {DICE_FACES.map((face, index) => {
        const surface = diceSurface(die, face), texture = textures.get(surface.color)![die.hidden.includes(face) ? 0 : faceValue(die.hand, face)];
        return <mesh key={face} ref={faceRefs.get(`${die.id}/${face}`)} geometry={geometries[index]} position={diceFaceTranslation(die, face)} castShadow={surface.opacity >= 0.99} receiveShadow
          onPointerDown={(event) => down(event, die)} onPointerMove={move} onPointerUp={up}
          onClick={(event) => { if (props.busy || event.delta > 3) return; event.stopPropagation(); props.onSelect(die.id); if (["pips", "color", "transparent", "inspect"].includes(props.tool)) props.onFace(die.id, face); }}>
          <meshPhysicalMaterial color="#ffffff" map={texture.map} bumpMap={texture.bump} bumpScale={0.027} roughness={0.28} clearcoat={0.35} clearcoatRoughness={0.25} side={DoubleSide} transparent={surface.opacity < 1} opacity={surface.opacity} depthWrite={surface.opacity >= 0.99} />
        </mesh>;
      })}
    </group>)}</group>
    {dice.map((die) => <DiceFaceOrigins key={die.id} die={preview?.id === die.id ? { ...die, position: preview.position } : die} selected={die.id === selectedId} />)}
    {dice.filter((die) => die.id === selectedId).map((die) => <mesh key={die.id} raycast={ignoreDiceHelperRaycast} {...diceSelectionMarker(preview?.id === die.id ? preview.position : die.position)}><ringGeometry args={[0.65, 0.68, 48]} /><meshBasicMaterial color="#c28c46" side={DoubleSide} transparent opacity={0.65} depthWrite={false} /></mesh>)}
    {props.arrows && !props.busy && !preview && <CubeNetFaceArrows key={occlusionKey} faces={arrows} occlude={occluders} onMove={(id) => { const arrow = arrows.find((item) => item.faceId === id); if (arrow) props.onMoveFace(arrow.dieId, arrow.face); }} />}
  </>;
}
/** 无点数的原位轮廓与来源线是观察辅助，不参与拾取或箭头遮挡。 */
function DiceFaceOrigins({ die, selected }: { die: TeachingDie; selected: boolean }) {
  return <group name={`dice-face-origins:${die.id}`}>{DICE_FACES.filter((face) => isDiceFaceMoved(die, face)).map((face) => {
    const corners = diceFaceCorners(die, face, false), origin = vector(die.position).addScaledVector(worldNormal(die, face), 0.5);
    const destination = origin.clone().add(diceFaceTranslation(die, face).applyQuaternion(quaternion(die.rotation)));
    return <group key={face}>
      <Line points={[...corners, corners[0]]} color="#c28c46" lineWidth={1} dashed dashSize={0.055} gapSize={0.04} transparent opacity={selected ? 0.65 : 0.28} depthTest={false} depthWrite={false} raycast={ignoreDiceHelperRaycast} />
      <Line points={[origin, destination]} color="#c28c46" lineWidth={1} dashed dashSize={0.07} gapSize={0.05} transparent opacity={selected ? 0.65 : 0.28} depthTest={false} depthWrite={false} raycast={ignoreDiceHelperRaycast} />
    </group>;
  })}</group>;
}
export default function DiceTeachingCanvas(props: DiceCanvasProps) {
  const m = diceTeachingMessages(props.locale);
  return <DiceCanvasBoundary label={m.fallback}><Canvas frameloop="demand" shadows dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} fallback={<p>{m.fallback}</p>} style={{ touchAction: "none" }}>
    <DiceObjects {...props} />
  </Canvas></DiceCanvasBoundary>;
}
