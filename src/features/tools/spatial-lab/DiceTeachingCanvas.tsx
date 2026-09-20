"use client";

import { Component, createRef, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { CanvasTexture, DoubleSide, EdgesGeometry, FrontSide, SRGBColorSpace, type Mesh } from "three";
import { THREE_SHADOWS } from "@/lib/three-runtime";
import type { Axis } from "@/features/spatial-math/domain";
import { SpatialCameraRig } from "@/features/spatial-math/renderer-r3f/SpatialCameraRig";
import type { CubeFrame, CubeView } from "./cube-structures-contract";
import { cubeWorkbenchCamera } from "./cube-workbench-camera";
import { CubeNetFaceArrows } from "./CubeNetFaceArrows";
import { DICE_BOARD_LIMIT, DICE_FACES, PIP_POINTS, diceFaceTranslation, faceValue, isDiceFaceMoved, quaternion, vector, worldNormal, type DiceFace, type DiceFootprint, type TeachingDie } from "./dice-teaching-model";
import { DICE_WHITE, DICE_TABLE_COLOR, DICE_TABLE_GRID_COLOR, DICE_TABLE_RENDERING, diceFaceArrows, dicePipShades, diceSelectionMarker, diceSurface, ignoreDiceHelperRaycast } from "./dice-teaching-display";
import { CubeMoveHandles } from "./CubeMoveHandles";
import type { CubeDragPreview } from "./cube-structures-drag-controller";
import type { CubeMoveOperation } from "./cube-structures-drag";
import { DICE_DRAG_GRID_ORIGIN, diceDragState, moveDiceByDrag } from "./dice-drag-adapter";
import { diceFaceCorners, diceFaceGeometries, DICE_UV_LENGTH } from "./dice-teaching-geometry";
import { diceTeachingMessages } from "./dice-teaching-messages";
import { DiceXRayTransition } from "./DiceXRayTransition";
import type { DiceXRayPresentation } from "./dice-xray-animation";
import { createDiceTapGuard, diceXRayPick, type DiceXRayTarget } from "./dice-xray-observation";
import { spatialDirectManipulation } from "../spatial-interaction/policy";
import { SpatialRotationControls } from "../spatial-interaction/SpatialRotationControls";
import { SpatialRollControls } from "../spatial-interaction/SpatialRollControls";
import type { SpatialRollAction } from "../spatial-interaction/SpatialRollButtons";

// 拖拽预览逐帧重绘时保持回调身份，避免相机误判为新的视角切换。
const ignoreCameraTransition = () => {};

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
  tool: "orbit" | "pan" | "move" | "pips" | "color" | "transparent" | "inspect" | "xray"; arrows: boolean; busy: boolean; grid: boolean; axes: boolean; floor: boolean;
  xrayTarget: DiceXRayTarget | null; onClearXRay: () => void;
  initialXRayTarget?: DiceXRayTarget | null;
  onXRayPresentation: (presentation: DiceXRayPresentation) => void;
  frame: CubeFrame; view: CubeView | "bottom"; cameraKey: number;
  snap: boolean; moveAxis: Axis; onMoveAxis: (axis: Axis) => void; onDragCommit: (operation: CubeMoveOperation) => void; onMoveUnavailable: () => void;
  onDraggingChange?: (dragging: boolean) => void;
  onSelect: (id: string) => void; onFace: (id: string, face: DiceFace) => void; onMoveFace: (id: string, face: DiceFace) => void;
  onRotate?: (axis: Axis, turn: -1 | 1) => void;
  rollAction?: SpatialRollAction;
}
class DiceCanvasBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert" className="p-8 text-sm">{this.props.label}</p> : this.props.children; }
}
function DiceObjects(props: DiceCanvasProps & { isTap: () => boolean }) {
  const { dice, selectedId, locale } = props;
  const m = diceTeachingMessages(locale);
  const geometries = useMemo(() => diceFaceGeometries(), []);
  const edges = useMemo(() => geometries.map((geometry) => new EdgesGeometry(geometry, 25)), [geometries]);
  const colorKey = [...new Set([DICE_WHITE, ...dice.flatMap((die) => DICE_FACES.map((face) => diceSurface(die, face).color))])].sort().join("|");
  const textures = useMemo(() => new Map(colorKey.split("|").map((color) => [color, Array.from({ length: 7 }, (_, value) => pipTextures(value, color))])), [colorKey]);
  const diceIds = dice.map((die) => die.id).join(",");
  const faceRefs = useMemo(() => new Map<string, RefObject<Mesh>>(diceIds.split(",").flatMap((id) => DICE_FACES.map((face) => [`${id}/${face}`, createRef<Mesh>() as RefObject<Mesh>] as const))), [diceIds]);
  const opaqueFaceIds = dice.flatMap((die) => DICE_FACES.filter((face) => diceSurface(die, face).opacity >= 0.99).map((face) => `${die.id}/${face}`));
  const occluders = opaqueFaceIds.map((id) => faceRefs.get(id)!);
  const occlusionKey = opaqueFaceIds.join("|");
  const [preview, setPreview] = useState<CubeDragPreview | null>(null);
  const dragging = preview !== null;
  const onDraggingChange = props.onDraggingChange;
  useEffect(() => { onDraggingChange?.(dragging); }, [onDraggingChange, dragging]);
  useEffect(() => () => { onDraggingChange?.(false); }, [onDraggingChange]);
  const dragState = useMemo(() => diceDragState(dice), [dice]);
  const presentedDice = useMemo(() => preview ? dice.map((die) => ({ ...die, position: preview.positions.get(die.id) ?? die.position })) : dice, [dice, preview]);
  const dragPresentation = useMemo(() => diceDragState(presentedDice), [presentedDice]);
  useEffect(() => () => { geometries.forEach((g) => g.dispose()); }, [geometries]);
  useEffect(() => () => { edges.forEach((g) => g.dispose()); }, [edges]);
  useEffect(() => () => { textures.forEach((palette) => palette.forEach((t) => { t.map.dispose(); t.bump.dispose(); })); }, [textures]);
  const arrows = diceFaceArrows(dice, selectedId, (die, face) => `${m.die} ${die.id.replace("dice-", "")} · ${m.faces[face]}`);
  const clickFace = (event: ThreeEvent<MouseEvent>, id: string, face: DiceFace) => {
    if (props.busy || props.tool === "move" || event.button !== 0 || event.delta > 3 || !props.isTap()) return;
    event.stopPropagation();
    const picked = props.tool === "xray" ? diceXRayPick(props.xrayTarget, { id, face }, event.intersections) : { id, face };
    props.onSelect(picked.id);
    if (["pips", "color", "transparent", "inspect", "xray"].includes(props.tool)) props.onFace(picked.id, picked.face);
  };
  const baseCamera = cubeWorkbenchCamera(props.frame, props.view === "bottom" ? "top" : props.view, "dice");
  const camera = props.view === "bottom" ? { ...baseCamera, position: { ...props.frame.center, y: props.frame.center.y - props.frame.radius * 4 }, up: { x: 0, y: 0, z: 1 } } : baseCamera;
  return <>
    <SpatialCameraRig bookmark={camera} radius={props.frame.radius} requestKey={props.cameraKey} axisSnapEnabled={props.snap} interactive navigationMode={props.tool === "pan" ? "pan" : props.tool === "move" ? "object" : "orbit"} onTransitionStateChange={ignoreCameraTransition} />
    <ambientLight intensity={1.35} /><hemisphereLight args={["#ffffff", "#8f9aa5", 1.4]} />
    <directionalLight position={[4, 9, 5]} intensity={3} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-bias={-0.0005} />
    <directionalLight position={[-5, -3, -5]} intensity={1.6} />
    {props.floor && <group>
      <mesh raycast={ignoreDiceHelperRaycast} renderOrder={DICE_TABLE_RENDERING.renderOrder} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[DICE_BOARD_LIMIT * 2, DICE_BOARD_LIMIT * 2]} /><meshStandardMaterial color={DICE_TABLE_COLOR} roughness={0.9} side={FrontSide} depthWrite={DICE_TABLE_RENDERING.depthWrite} /></mesh>
      {[-1, 1].flatMap((sign) => ([
        <mesh key={`x${sign}`} raycast={ignoreDiceHelperRaycast} renderOrder={DICE_TABLE_RENDERING.renderOrder} position={[sign * DICE_BOARD_LIMIT, 0.3, 0]}><boxGeometry args={[0.3, 0.6, DICE_BOARD_LIMIT * 2]} /><meshStandardMaterial color={DICE_TABLE_COLOR} depthWrite={DICE_TABLE_RENDERING.depthWrite} /></mesh>,
        <mesh key={`z${sign}`} raycast={ignoreDiceHelperRaycast} renderOrder={DICE_TABLE_RENDERING.renderOrder} position={[0, 0.3, sign * DICE_BOARD_LIMIT]}><boxGeometry args={[DICE_BOARD_LIMIT * 2, 0.6, 0.3]} /><meshStandardMaterial color={DICE_TABLE_COLOR} depthWrite={DICE_TABLE_RENDERING.depthWrite} /></mesh>,
      ]))}
    </group>}
    {props.grid && <gridHelper raycast={ignoreDiceHelperRaycast} renderOrder={DICE_TABLE_RENDERING.renderOrder + 1} material-depthWrite={false} args={[DICE_BOARD_LIMIT * 2, DICE_BOARD_LIMIT * 2, DICE_TABLE_GRID_COLOR, DICE_TABLE_GRID_COLOR]} position={[0, 0.003, 0]} />}
    {props.axes && <group><axesHelper raycast={ignoreDiceHelperRaycast} args={[2.6]} /><Html position={[2.8, 0, 0]} center><span className="text-xs text-red-600">X</span></Html><Html position={[0, 0, 2.8]} center><span className="text-xs text-blue-600">Z</span></Html><Html position={[0, 2.8, 0]} center><span className="text-xs text-green-700">Y</span></Html></group>}
    {props.trail.flatMap((stamp, index) => stamp.points.map((point, pip) => <mesh raycast={ignoreDiceHelperRaycast} key={`${index}:${pip}`} position={[point.x, point.y, point.z]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.065, 16]} /><meshBasicMaterial color={dicePipShades(stamp.value)[1]} side={DoubleSide} /></mesh>))}
    <group>{presentedDice.map((die) => <group key={die.id} userData={{ spatialObjectId: die.id }} position={vector(die.position)} quaternion={quaternion(die.rotation)}>
      {DICE_FACES.map((face, index) => {
        const surface = diceSurface(die, face), texture = textures.get(surface.color)![die.hidden.includes(face) ? 0 : faceValue(die.hand, face)];
        return <mesh key={face} ref={faceRefs.get(`${die.id}/${face}`)} geometry={geometries[index]} position={diceFaceTranslation(die, face)} castShadow={surface.opacity >= 0.99} receiveShadow
          onClick={(event) => clickFace(event, die.id, face)}>
          <meshPhysicalMaterial color="#ffffff" map={texture.map} bumpMap={texture.bump} bumpScale={0.027} roughness={0.28} clearcoat={0.35} clearcoatRoughness={0.25} side={DoubleSide} transparent={surface.opacity < 1} opacity={surface.opacity} depthWrite={surface.opacity >= 0.99} />
        </mesh>;
      })}
    </group>)}</group>
    {presentedDice.map((die) => <DiceFaceOrigins key={die.id} die={die} selected={die.id === selectedId} />)}
    {presentedDice.filter((die) => die.id === selectedId).map((die) => <mesh key={die.id} raycast={ignoreDiceHelperRaycast} {...diceSelectionMarker(die.position)}><ringGeometry args={[0.65, 0.68, 48]} /><meshBasicMaterial color="#c28c46" side={DoubleSide} transparent opacity={0.65} depthWrite={false} /></mesh>)}
    {spatialDirectManipulation(props.tool) && !props.busy && <CubeMoveHandles presentation={dragPresentation} preview={preview} onPreview={setPreview} pickRenderedObjects
      interaction={{ state: dragState, ids: [selectedId], scopeIds: dice.map((die) => die.id), axis: props.moveAxis, kind: "move", snapToGrid: props.snap, gridOrigin: DICE_DRAG_GRID_ORIGIN,
        bodyAxis: "gesture",
        isValidOperation: (operation) => moveDiceByDrag(dice, operation) !== null, onAxisChange: props.onMoveAxis, onSelect: props.onSelect, onCommit: props.onDragCommit, onUnavailable: props.onMoveUnavailable }} />}
    {spatialDirectManipulation(props.tool) && !props.rollAction && props.onRotate && !preview && presentedDice.filter((die) => die.id === selectedId).map((die) => <SpatialRotationControls key={die.id} center={die.position} vertices={DICE_FACES.flatMap((face) => diceFaceCorners(die, face))}
      action={{ axis: props.moveAxis, onAxisChange: props.onMoveAxis, onRotate: props.onRotate!, label: m.turn, disabled: props.busy }} />)}
    {spatialDirectManipulation(props.tool) && props.rollAction && !preview && presentedDice.filter((die) => die.id === selectedId).map((die) => <SpatialRollControls key={die.id} center={die.position} vertices={DICE_FACES.flatMap((face) => diceFaceCorners(die, face))} action={{ ...props.rollAction!, disabled: props.busy }} />)}
    <DiceXRayTransition dice={dice} requested={props.xrayTarget} initialTarget={props.initialXRayTarget} interactive={props.tool === "xray" && !props.busy} geometries={geometries} edges={edges} textures={textures}
      onClick={(event, target) => clickFace(event, target.id, target.face)} onPresentation={props.onXRayPresentation} />
    {props.arrows && props.tool !== "xray" && !props.busy && !preview && <CubeNetFaceArrows key={occlusionKey} faces={arrows} occlude={occluders} onMove={(id) => { const arrow = arrows.find((item) => item.faceId === id); if (arrow) props.onMoveFace(arrow.dieId, arrow.face); }} />}
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
  const [tap] = useState(createDiceTapGuard);
  useEffect(() => { window.addEventListener("blur", tap.reset); return () => window.removeEventListener("blur", tap.reset); }, [tap]);
  return <DiceCanvasBoundary label={m.fallback}><Canvas frameloop="demand" shadows={THREE_SHADOWS.filtered} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true, stencil: true }} fallback={<p>{m.fallback}</p>} style={{ touchAction: "none" }}
    onPointerDownCapture={tap.down} onPointerMoveCapture={tap.move} onPointerUpCapture={tap.up} onPointerCancelCapture={tap.cancel}
    onPointerMissed={(event) => { if (event.type === "click" && event.button === 0 && tap.isTap() && props.tool === "xray" && !props.busy) props.onClearXRay(); }}>
    <DiceObjects {...props} isTap={tap.isTap} />
  </Canvas></DiceCanvasBoundary>;
}
