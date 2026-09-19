"use client";

import { Html, Line } from "@react-three/drei";
import { DoubleSide } from "three";
import { CUBE_COLORS, cubeGroupOutlineColor } from "../spatial-lab/cube-structures-contract";
import type { CapacityVesselKind, SolidCapacitySnapshot } from "./solid-capacity-contract";
import type { CapacityPresentation } from "./solid-capacity-motion";
import { capacityCenters, liquidHeight, liquidRadii, vesselCapacity, vesselLiquidVolume } from "./solid-capacity";
import { solidCapacityMessages } from "./solid-capacity-messages";

const ignoreRaycast = () => null;
function number(value: number) { return Number(value.toFixed(2)).toString(); }
/** 水平液面由解析液量决定；透明外壳复用立体实体，不另造相机或观察操作。 */
export function SolidCapacityLiquids({ frame, snapshot, locale }: { frame: CapacityPresentation; snapshot: SolidCapacitySnapshot; locale: string }) {
  const centers = capacityCenters(frame), m = solidCapacityMessages(locale);
  const coneChanging = vesselLiquidVolume(frame.cone, "cone") - vesselLiquidVolume(snapshot.cone, "cone");
  const cylinderChanging = vesselLiquidVolume(frame.cylinder, "cylinder") - vesselLiquidVolume(snapshot.cylinder, "cylinder");
  const transferring = coneChanging * cylinderChanging < -1e-8;
  return <>
    {(["cone", "cylinder"] as const).map((kind: CapacityVesselKind) => {
      const orientation = frame.coneAngle > Math.PI / 2 ? "tip-down" : "tip-up";
      const vessel = frame[kind], height = liquidHeight(vessel, kind, orientation), radii = liquidRadii(vessel, kind, orientation);
      const baseY = kind === "cone" && orientation === "tip-down" ? vessel.height : 0;
      const upright = kind === "cylinder" || Math.abs(Math.sin(frame.coneAngle)) < 1e-6;
      return <group key={kind} position={[centers[kind], 0, 0]}>
        {height > 1e-7 && <mesh position={[0, height / 2, 0]} raycast={ignoreRaycast} renderOrder={1}>
          <cylinderGeometry args={[radii.top * 0.998, radii.bottom * 0.998, height * 0.999, 64, 1, false]} />
          <meshStandardMaterial color={CUBE_COLORS[3]} transparent opacity={0.68} depthWrite={false} side={DoubleSide} roughness={0.35} />
        </mesh>}
        <Html center position={[0, -0.32, 0]} style={{ pointerEvents: "none", whiteSpace: "nowrap" }} zIndexRange={[4, 0]}>
          <div className="rounded bg-paper/90 px-1 text-center text-xs text-ink"><div>{m[kind]}</div>
            {snapshot.showAmounts && <div>{number(vesselLiquidVolume(vessel, kind))} / {number(vesselCapacity(vessel, kind))} {m.units}</div>}
          </div>
        </Html>
        {snapshot.showDimensions && upright && <>
          <Line points={[[0, baseY, 0], [vessel.radius, baseY, 0]]} color={cubeGroupOutlineColor(CUBE_COLORS[2])} lineWidth={1.3} raycast={ignoreRaycast} />
          <Line points={[[vessel.radius + 0.13, 0, 0], [vessel.radius + 0.13, vessel.height, 0]]} color={cubeGroupOutlineColor(CUBE_COLORS[2])} lineWidth={1.3} raycast={ignoreRaycast} />
          <Html center position={[vessel.radius / 2, baseY + 0.08, 0]} style={{ pointerEvents: "none", whiteSpace: "nowrap" }} zIndexRange={[4, 0]}><span className="rounded bg-paper/90 px-1 text-[11px]">r = {number(vessel.radius)}</span></Html>
          <Html center position={[vessel.radius + 0.38, vessel.height / 2, 0]} style={{ pointerEvents: "none", whiteSpace: "nowrap" }} zIndexRange={[4, 0]}><span className="rounded bg-paper/90 px-1 text-[11px]">h = {number(vessel.height)}</span></Html>
        </>}
      </group>;
    })}
    {transferring && <Line points={[
      [centers.cone, frame.cone.height + 0.12, 0],
      [centers.cone * 0.35, Math.max(frame.cone.height, frame.cylinder.height) + 0.6, 0],
      [centers.cylinder * 0.35, Math.max(frame.cone.height, frame.cylinder.height) + 0.6, 0],
      [centers.cylinder, frame.cylinder.height + 0.12, 0],
    ]} color={CUBE_COLORS[3]} lineWidth={2.4} transparent opacity={0.6} dashed dashSize={0.1} gapSize={0.07} raycast={ignoreRaycast} />}
  </>;
}
