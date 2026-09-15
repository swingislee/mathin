import { CUBE_COLORS, cubeGroupOutlineColor, type CubeColor } from "./cube-structures-contract";
import type { CubeNetRevealFace } from "./cube-net-face-reveal";
import { DICE_FACES, IDENTITY_ROTATION, arrangeDice, closeDieFaces, diceFaceTranslation, quaternion, vector, worldNormal, type DiceFace, type DiceScene, type DiceVector, type TeachingDie } from "./dice-teaching-model";

export const DICE_WHITE = "#ffffff";
export const DICE_TABLE_COLOR = cubeGroupOutlineColor(CUBE_COLORS[3]);
export const DICE_TABLE_GRID_COLOR = CUBE_COLORS[3];
/** 桌面是先绘制的教学参照；不写深度，让真实下移的底面保持可见。 */
export const DICE_TABLE_RENDERING = { renderOrder: -10, depthWrite: false } as const;
export const DICE_RED_PIPS = ["#a71e25", "#c62e36", "#dc6469"] as const;
export const DICE_BLACK_PIPS = ["#151719", "#26292c", "#55585a"] as const;
export function dicePipShades(value: number) { return value === 1 || value === 4 ? DICE_RED_PIPS : DICE_BLACK_PIPS; }
export interface DiceSurfaceStyle { color?: CubeColor; opacity?: number }
export function diceSurface(die: TeachingDie, face: DiceFace) {
  return { color: die.surfaces?.[face]?.color ?? DICE_WHITE, opacity: die.surfaces?.[face]?.opacity ?? 1 };
}
export function styleDiceFaces(dice: readonly TeachingDie[], id: string, faces: readonly DiceFace[], style: DiceSurfaceStyle): TeachingDie[] {
  return dice.map((die) => die.id === id ? { ...die, surfaces: { ...die.surfaces, ...Object.fromEntries(faces.map((face) => [face, { ...die.surfaces?.[face], ...style }])) } } : die);
}
/** 移面复原只合拢六面，保留摆放、题设、点数显隐与教学样式。 */
export function closeDiceFaces(scene: DiceScene): DiceScene { return { ...scene, dice: scene.dice.map((die) => closeDieFaces(die)) }; }
/** 整体复原保留老师添加的骰子及手性，以一个可撤销步骤恢复白色、朝向与点数。 */
export function restoreDiceScene(scene: DiceScene): DiceScene {
  return { ...scene, trail: [], puzzle: null, dice: arrangeDice(scene.dice, "apart").map((die) => ({ ...die, rotation: { ...IDENTITY_ROTATION }, hidden: [], offsets: {}, surfaces: {} })) };
}
export type DiceFaceArrow = CubeNetRevealFace & { dieId: string; face: DiceFace };
export function diceFaceArrow(die: TeachingDie, face: DiceFace, label: string): DiceFaceArrow {
  const normal = worldNormal(die, face), translation = diceFaceTranslation(die, face).applyQuaternion(quaternion(die.rotation));
  const center = vector(die.position).addScaledVector(normal, 0.5).add(translation), expanded = translation.lengthSq() > 0.000001;
  const outward = normal.clone();
  return { dieId: die.id, face, faceId: `${die.id}/${face}`, label, normal, translation, center,
    position: center.clone().addScaledVector(outward, 0.9), expanded, direction: outward.multiplyScalar(expanded ? -1 : 1) };
}
export function diceFaceArrows(dice: readonly TeachingDie[], selectedId: string, label: (die: TeachingDie, face: DiceFace) => string): DiceFaceArrow[] {
  return dice.filter((die) => die.id === selectedId).flatMap((die) => DICE_FACES.map((face) => diceFaceArrow(die, face, label(die, face))));
}
/** 装饰网格／坐标／选中提示不参与拾取或遮挡判定。 */
export function ignoreDiceHelperRaycast() {}
export function diceSelectionMarker(position: DiceVector) {
  return { position: [position.x, 0.006, position.z] as [number, number, number], rotation: [-Math.PI / 2, 0, 0] as [number, number, number] };
}
