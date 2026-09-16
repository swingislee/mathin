"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import type { BufferGeometry, Group, Texture } from "three";
import type { TeachingDie } from "./dice-teaching-model";
import { diceXRayDisplay, type DiceXRayTarget } from "./dice-xray-observation";
import { applyDiceXRayOpacity, diceXRayPresentation, sameDiceXRayTarget, stepDiceXRayMotion, type DiceXRayMotion, type DiceXRayPresentation } from "./dice-xray-animation";
import { DiceXRayOverlay } from "./DiceXRayOverlay";

interface Props {
  dice: readonly TeachingDie[];
  requested: DiceXRayTarget | null;
  initialTarget?: DiceXRayTarget | null;
  interactive: boolean;
  geometries: readonly BufferGeometry[];
  edges: readonly BufferGeometry[];
  textures: ReadonlyMap<string, readonly { map: Texture; bump: Texture }[]>;
  onClick: (event: ThreeEvent<MouseEvent>, target: DiceXRayTarget) => void;
  onPresentation: (presentation: DiceXRayPresentation) => void;
}

/** 教学透明过程独立播放；相机保持可操作，逐帧只写临时材质。 */
export function DiceXRayTransition({ dice, requested, initialTarget = null, interactive, geometries, edges, textures, onClick, onPresentation }: Props) {
  const invalidate = useThree((state) => state.invalidate);
  const motion = useRef<DiceXRayMotion>({ target: initialTarget, progress: initialTarget ? 1 : 0 });
  const reported = useRef<DiceXRayPresentation>({ target: initialTarget, phase: initialTarget ? "open" : "closed" });
  const group = useRef<Group>(null);
  const [shown, setShown] = useState<DiceXRayTarget | null>(initialTarget);
  const wanted = interactive && dice.some((die) => die.id === requested?.id) ? requested : null;
  const diceIds = dice.map((die) => die.id).join(",");
  useEffect(() => { invalidate(); }, [wanted?.id, wanted?.face, diceIds, invalidate]);
  useFrame((_, delta) => {
    const current = motion.current.target && !dice.some((die) => die.id === motion.current.target?.id) ? { target: null, progress: 0 } : motion.current;
    // 按需渲染首次唤醒与后台恢复时，保留可见中间帧，不用大 delta 跳到终点。
    const next = stepDiceXRayMotion(current, wanted, Math.min(delta * 1000, 50));
    motion.current = next;
    const mounted = sameDiceXRayTarget(next.target, shown);
    if (!mounted) setShown(next.target);
    if (group.current) {
      group.current.visible = mounted && next.progress > 0;
      const display = diceXRayDisplay(dice, next.target);
      if (mounted && display) applyDiceXRayOpacity(group.current, next.progress, display.surface.opacity);
    }
    const presentation = diceXRayPresentation(next, wanted);
    if (presentation.phase !== reported.current.phase || !sameDiceXRayTarget(presentation.target, reported.current.target)) {
      reported.current = presentation; onPresentation(presentation);
    }
    if (!mounted || presentation.phase === "opening" || presentation.phase === "closing") invalidate();
  }, -1);
  const display = diceXRayDisplay(dice, shown);
  return display && <DiceXRayOverlay ref={group} dice={dice} display={display} geometries={geometries} edges={edges} texture={textures.get(display.surface.color)![display.textureValue]}
    interactive={interactive} onClick={(event) => onClick(event, { id: display.die.id, face: display.face })} />;
}
