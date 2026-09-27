"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { Html, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type Camera, type Group } from "three";
import { CUBE_COLORS } from "../spatial-lab/cube-structures-contract";
import { SPATIAL_GROUND_LABEL_ROTATION, SpatialSurfaceLabel, spatialGroundVisible } from "../spatial-interaction/SpatialSurfaceLabel";
import type { PlaceValueSide, PlaceValueSnapshot } from "./radix-contract";
import { placeValueColumn, placeValueOffset, placeValuePlaces } from "./radix-model";
import { placeValueMessages } from "./messages";
import styles from "./PlaceValueWorkspace.module.css";

const ignoreRaycast = () => null;
export type PlaceValueControlRenderer = (side: PlaceValueSide, level: number) => ReactNode;
/** 数字与数位同一世界锚点；侧视时照实重叠，不做屏幕上的自动避让或重新排序。 */
export function placeValueControlPositions(camera: Camera, size: { width: number; height: number }, mode: PlaceValueSnapshot["mode"], digits = 3) {
  const sides: PlaceValueSide[] = mode === "compare" ? ["left", "right"] : ["left"];
  const width = Math.max(28, Math.min(108, size.width * .12, (size.width - 64) / (sides.length * digits)));
  const project = (x: number) => {
    const p = new Vector3(x, -.65, .8).project(camera);
    return [(p.x + 1) * size.width / 2, (1 - p.y) * size.height / 2] as [number, number];
  };
  return { width, positions: Object.fromEntries(sides.flatMap((side) => placeValuePlaces(digits).map((level) =>
    [side + ":" + level, project(placeValueColumn(level, digits) + placeValueOffset(mode, side, digits))]))),
    carries: Object.fromEntries(sides.flatMap((side) => placeValuePlaces(digits - 1).map((level) =>
      [side + ":" + level, project((placeValueColumn(level, digits) + placeValueColumn(level + 1, digits)) / 2 + placeValueOffset(mode, side, digits))]))) };
}
function DepthRuler({ x, length, radix, locale }: { x: number; length: number; radix: number; locale: "zh" | "en" }) {
  const group = useRef<Group>(null), direction = useRef(new Vector3());
  useFrame(({ camera }) => { if (group.current) group.current.visible = spatialGroundVisible(camera.getWorldDirection(direction.current)); });
  const divisions = length > 1 ? radix : 1, step = length / divisions;
  return <group ref={group} name="place-value-depth-ruler" visible={false}>
    <Line points={[[x, -.025, .5], [x, -.025, .5 - length]]} color={CUBE_COLORS[5]} transparent opacity={.7} lineWidth={1} raycast={ignoreRaycast} />
    {Array.from({ length: divisions + 1 }, (_, index) => <Line key={index} points={[[x - .15, -.025, .5 - index * step], [x + .12, -.025, .5 - index * step]]} color={CUBE_COLORS[5]} transparent opacity={.7} lineWidth={1} raycast={ignoreRaycast} />)}
    <SpatialSurfaceLabel text={placeValueMessages(locale).depth(length)} position={[x - .6, -.025, .5 - length / 2]} rotation={SPATIAL_GROUND_LABEL_ROTATION} />
  </group>;
}
export function PlaceValueStage({ snapshot, progress, locale, renderPlaceControl, renderCarryControl }: {
  snapshot: PlaceValueSnapshot; progress: number; locale: "zh" | "en"; renderPlaceControl?: PlaceValueControlRenderer; renderCarryControl?: PlaceValueControlRenderer;
}) {
  const size = useThree((state) => state.size), camera = useThree((state) => state.camera);
  const sides: PlaceValueSide[] = snapshot.mode === "compare" ? ["left", "right"] : ["left"];
  const digits = snapshot.left.places.length, width = placeValueControlPositions(camera, size, snapshot.mode, digits).width;
  return <group name="place-value-stations">
    {sides.flatMap((side) => placeValuePlaces(digits).map((level) => {
      const x = placeValueColumn(level, digits) + placeValueOffset(snapshot.mode, side, digits);
      const hasUnits = snapshot[side].places[level].length > 0 || (progress < 1 && snapshot.motion?.side === side && snapshot.motion.before.places[level].length > 0);
      return <group key={side + level}>
        <mesh position={[x, -.09, 0]} raycast={ignoreRaycast}><boxGeometry args={[1.6, .14, 1.6]} /><meshBasicMaterial color={CUBE_COLORS[5]} transparent opacity={.16} depthWrite={false} /></mesh>
        <Line points={[[x - .8, -.015, .8], [x + .8, -.015, .8], [x + .8, -.015, -.8], [x - .8, -.015, -.8], [x - .8, -.015, .8]]} color={CUBE_COLORS[5]} transparent opacity={.65} lineWidth={1.5} raycast={ignoreRaycast} />
        {hasUnits && <DepthRuler x={x - 1.1} length={snapshot[side].radix ** level} radix={snapshot[side].radix} locale={locale} />}
        {renderPlaceControl && <Html position={[x, -.65, .8]} zIndexRange={[6, 4]} calculatePosition={(_, liveCamera, liveSize) => placeValueControlPositions(liveCamera, liveSize, snapshot.mode, digits).positions[side + ":" + level]}
          style={{ pointerEvents: "none", "--place-control-width": width + "px" } as CSSProperties}>{renderPlaceControl(side, level)}</Html>}
        {level < digits - 1 && renderCarryControl && <Html position={[x - 2.5, -.65, .8]} zIndexRange={[7, 6]}
          calculatePosition={(_, liveCamera, liveSize) => placeValueControlPositions(liveCamera, liveSize, snapshot.mode, digits).carries[side + ":" + level]}
          style={{ pointerEvents: "none" }}>{renderCarryControl(side, level)}</Html>}
      </group>;
    }))}
    {snapshot.mode === "compare" && snapshot.comparison !== "hidden" && <Html position={[0, -2, .8]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}><span className={styles.comparison}>{snapshot.comparison}</span></Html>}
  </group>;
}
