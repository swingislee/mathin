"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide, type BufferGeometry, type Texture } from "three";
import { DICE_FACES, diceFaceTranslation, quaternion, vector, type TeachingDie } from "./dice-teaching-model";
import { diceSurface, ignoreDiceHelperRaycast } from "./dice-teaching-display";
import { DICE_XRAY_OCCLUDER, DICE_XRAY_SURFACE, DICE_XRAY_WINDOW, type diceXRayDisplay } from "./dice-xray-observation";

interface Props {
  dice: readonly TeachingDie[];
  display: NonNullable<ReturnType<typeof diceXRayDisplay>>;
  geometries: readonly BufferGeometry[];
  edges: readonly BufferGeometry[];
  texture: { map: Texture; bump: Texture };
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}

/** 面的位置和朝向直接复用实体；只在目标投影内覆盖遮挡，不移动面或相机。 */
export function DiceXRayOverlay({ dice, display, geometries, edges, texture, onClick }: Props) {
  const { die, face, surface } = display, index = DICE_FACES.indexOf(face);
  return <group name="dice-xray-observation">
    <group position={vector(die.position)} quaternion={quaternion(die.rotation)}>
      <group position={diceFaceTranslation(die, face)}>
        <mesh geometry={geometries[index]} renderOrder={100} raycast={ignoreDiceHelperRaycast}>
          <meshBasicMaterial {...DICE_XRAY_WINDOW} color="#f5f3ed" side={DoubleSide} forceSinglePass />
        </mesh>
        <mesh name={DICE_XRAY_SURFACE} geometry={geometries[index]} renderOrder={101} onClick={onClick}>
          <meshPhysicalMaterial color="#ffffff" map={texture.map} bumpMap={texture.bump} bumpScale={0.027} roughness={0.28} clearcoat={0.35} clearcoatRoughness={0.25}
            side={DoubleSide} transparent opacity={surface.opacity} depthTest={false} depthWrite={false} forceSinglePass />
        </mesh>
        <lineSegments geometry={edges[index]} renderOrder={103} raycast={ignoreDiceHelperRaycast}>
          <lineBasicMaterial color="#b07d35" transparent opacity={0.95} depthTest={false} depthWrite={false} />
        </lineSegments>
      </group>
    </group>
    {dice.map((item) => <group key={item.id} position={vector(item.position)} quaternion={quaternion(item.rotation)}>
      {DICE_FACES.map((itemFace, faceIndex) => (item.id !== die.id || itemFace !== face) && diceSurface(item, itemFace).opacity > 0 &&
        <lineSegments key={itemFace} geometry={edges[faceIndex]} position={diceFaceTranslation(item, itemFace)} renderOrder={102} raycast={ignoreDiceHelperRaycast}>
          <lineBasicMaterial {...DICE_XRAY_OCCLUDER} color="#837d70" />
        </lineSegments>)}
    </group>)}
  </group>;
}
