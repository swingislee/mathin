import { AlwaysDepth, AlwaysStencilFunc, EqualStencilFunc, KeepStencilOp, LessDepth, ReplaceStencilOp } from "three";
import { diceSurface } from "./dice-teaching-display";
import { DICE_FACES, faceValue, nearestDiceRotation, oppositeFace, worldFace, type DiceFace, type TeachingDie } from "./dice-teaching-model";

/** 观察焦点属于视图，不写入骰子、题设或撤销历史。 */
export interface DiceXRayTarget { readonly id: string; readonly face: DiceFace }
export const DICE_XRAY_SURFACE = "dice-xray-surface";

export function nextDiceXRayTarget(current: DiceXRayTarget | null, clicked: DiceXRayTarget): DiceXRayTarget | null {
  return current?.id === clicked.id && current.face === clicked.face ? null : { id: clicked.id, face: oppositeFace(clicked.face) };
}

export function diceXRayDisplay(dice: readonly TeachingDie[], target: DiceXRayTarget | null) {
  const die = target && dice.find((item) => item.id === target.id);
  if (!die || !target) return null;
  const { face } = target;
  return {
    die, face, surface: diceSurface(die, face),
    textureValue: die.hidden.includes(face) ? 0 : faceValue(die.hand, face),
    direction: DICE_FACES.find((direction) => worldFace({ ...die, rotation: nearestDiceRotation(die.rotation) }, direction) === face) ?? face,
  };
}

/** 透视层在真实深度后方；拾取仍优先响应屏幕上看见的目标，而不是前方实体。 */
export function diceXRayPick(target: DiceXRayTarget | null, clicked: DiceXRayTarget, hits: readonly { object: { name: string } }[]): DiceXRayTarget {
  return target && hits.some((hit) => hit.object.name === DICE_XRAY_SURFACE) ? target : clicked;
}

// 三次局部覆盖：同位底衬隔离点数、原面内容、遮挡物细轮廓。模板缓冲限制在目标投影内。
export const DICE_XRAY_WINDOW = {
  transparent: true, depthTest: true, depthFunc: AlwaysDepth, depthWrite: true,
  stencilWrite: true, stencilRef: 1, stencilFunc: AlwaysStencilFunc,
  stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: ReplaceStencilOp,
} as const;
export const DICE_XRAY_OCCLUDER = {
  transparent: true, opacity: 0.22, depthTest: true, depthFunc: LessDepth, depthWrite: false,
  stencilWrite: true, stencilRef: 1, stencilFunc: EqualStencilFunc,
  stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: KeepStencilOp,
} as const;

type PointerSample = Pick<PointerEvent, "pointerId" | "clientX" | "clientY">;
/** 按整段手势判定轻点；绕一圈回原处和双指缩放均不触发观察切换。 */
export function createDiceTapGuard() {
  const pointers = new Set<number>();
  let start: PointerSample | null = null, dragged = true;
  const move = (event: PointerSample) => {
    if (start?.pointerId === event.pointerId && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > 3) dragged = true;
  };
  return {
    down(event: PointerSample) { if (!pointers.size) { start = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }; dragged = false; } else dragged = true; pointers.add(event.pointerId); },
    move,
    up(event: PointerSample) { move(event); pointers.delete(event.pointerId); },
    cancel(event: PointerSample) { dragged = true; pointers.delete(event.pointerId); },
    reset() { pointers.clear(); start = null; dragged = true; },
    isTap() { return !!start && !dragged && pointers.size === 0; },
  };
}
