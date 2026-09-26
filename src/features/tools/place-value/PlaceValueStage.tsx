"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { Html, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type Camera, type Group } from "three";
import { CUBE_COLORS } from "../spatial-lab/cube-structures-contract";
import type { PlaceValuePlace, PlaceValueSide, PlaceValueSnapshot } from "./contract";
import { PLACE_VALUE_COLUMNS, PLACE_VALUE_PLACES, PLACE_VALUE_WEIGHTS, placeValueOffset } from "./model";
import { placeValueMessages } from "./messages";
import styles from "./PlaceValueWorkspace.module.css";

const ignoreRaycast = () => null;
export type PlaceValueControlRenderer = (side: PlaceValueSide, place: PlaceValuePlace) => ReactNode;

/** 相机侧视/远景时仅避让屏幕控件，数学列与镜头支点始终不动。 */
export function placeValueControlPositions(camera: Camera, size: { width: number; height: number }, mode: PlaceValueSnapshot["mode"]) {
  const sides: PlaceValueSide[] = mode === "compare" ? ["left", "right"] : ["left"];
  const width = Math.min(108, size.width * .12, (size.width - 72) / (sides.length * 3) - 8);
  const half = width / 2 + 8, max = size.width - half - 48;
  const items = sides.flatMap((side) => PLACE_VALUE_PLACES.map((place, index) => {
    const p = new Vector3(PLACE_VALUE_COLUMNS[place] + placeValueOffset(mode, side), -.65, .8).project(camera);
    return { key: side + ":" + place, order: (side === "left" ? 0 : 3) + index,
      x: Math.max(half, Math.min(max, (p.x + 1) * size.width / 2)), y: Math.max(64, Math.min(size.height - 170, (1 - p.y) * size.height / 2)) };
  })).sort((a, b) => Math.abs(a.x - b.x) < 1 ? a.order - b.order : a.x - b.x);
  for (let index = 1; index < items.length; index++) items[index].x = Math.max(items[index].x, items[index - 1].x + width + 8);
  items.at(-1)!.x = Math.min(items.at(-1)!.x, max);
  for (let index = items.length - 2; index >= 0; index--) items[index].x = Math.min(items[index].x, items[index + 1].x - width - 8);
  return { width, positions: Object.fromEntries(items.map((item) => [item.key, [item.x, item.y] as [number, number]])) };
}

function DepthRuler({ x, length, locale }: { x: number; length: number; locale: "zh" | "en" }) {
  const group = useRef<Group>(null), label = useRef<HTMLSpanElement>(null);
  useFrame(({ camera }) => {
    const direction = camera.getWorldDirection(new Vector3());
    const visible = Math.abs(direction.z) < .985;
    if (group.current) group.current.visible = visible;
    if (label.current) label.current.style.visibility = visible ? "visible" : "hidden";
  });
  const step = length === 100 ? 10 : 1;
  return <group ref={group} name="place-value-depth-ruler">
    <Line points={[[x, -.025, .5], [x, -.025, .5 - length]]} color={CUBE_COLORS[5]} transparent opacity={.7} lineWidth={1} raycast={ignoreRaycast} />
    {Array.from({ length: length / step + 1 }, (_, index) => <Line key={index} points={[[x - (index % 5 === 0 ? .22 : .12), -.025, .5 - index * step], [x + .12, -.025, .5 - index * step]]} color={CUBE_COLORS[5]} transparent opacity={.7} lineWidth={1} raycast={ignoreRaycast} />)}
    <Html position={[x - .8, -.025, .5 - length / 2]} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}><span ref={label} className={styles.ruler}>{placeValueMessages(locale).depth(length)}</span></Html>
  </group>;
}

export function PlaceValueStage({ snapshot, progress, locale, renderPlaceControl }: { snapshot: PlaceValueSnapshot; progress: number; locale: "zh" | "en"; renderPlaceControl?: PlaceValueControlRenderer }) {
  const size = useThree((state) => state.size), camera = useThree((state) => state.camera);
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"];
  const width = placeValueControlPositions(camera, size, snapshot.mode).width;
  return <group name="place-value-stations">
    {sides.flatMap((side) => PLACE_VALUE_PLACES.map((place) => {
      const x = PLACE_VALUE_COLUMNS[place] + placeValueOffset(snapshot.mode, side);
      const hasUnits = snapshot[side][place].length > 0 || (progress < 1 && snapshot.motion?.side === side && snapshot.motion.before[place].length > 0);
      return <group key={side + place}>
        <mesh position={[x, -.09, 0]} raycast={ignoreRaycast}><boxGeometry args={[1.6, .14, 1.6]} /><meshBasicMaterial color={CUBE_COLORS[5]} transparent opacity={.16} depthWrite={false} /></mesh>
        <Line points={[[x - .8, -.015, .8], [x + .8, -.015, .8], [x + .8, -.015, -.8], [x - .8, -.015, -.8], [x - .8, -.015, .8]]} color={CUBE_COLORS[5]} transparent opacity={.65} lineWidth={1.5} raycast={ignoreRaycast} />
        {hasUnits && <DepthRuler x={x - 1.1} length={PLACE_VALUE_WEIGHTS[place]} locale={locale} />}
        {renderPlaceControl && <Html position={[x, -.65, .8]} zIndexRange={[6, 4]} calculatePosition={(_, liveCamera, liveSize) => placeValueControlPositions(liveCamera, liveSize, snapshot.mode).positions[side + ":" + place]}
          style={{ pointerEvents: "none", "--place-control-width": width + "px" } as CSSProperties}>{renderPlaceControl(side, place)}</Html>}
      </group>;
    }))}
    {snapshot.mode === "compare" && snapshot.comparison !== "hidden" && <Html position={[0, -2, .8]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}><span className={styles.comparison}>{snapshot.comparison}</span></Html>}
  </group>;
}
