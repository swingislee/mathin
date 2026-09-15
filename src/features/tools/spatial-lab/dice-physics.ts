import type RAPIER from "@dimforge/rapier3d-compat";
import { DICE_BOARD_LIMIT, interpolateDice, worldFace, type TeachingDie } from "./dice-teaching-model";

let engine: Promise<typeof RAPIER> | undefined;
function loadEngine() {
  engine ??= import("@dimforge/rapier3d-compat").then(async (module) => { await module.init(); return module.default; }).catch((error: unknown) => { engine = undefined; throw error; });
  return engine;
}
export interface DiceThrow { frames: TeachingDie[][]; durationMs: number; settled: boolean }

/** 固定步长刚体模拟：结果只由重力、碰撞与随机初始速度产生，不预选朝上的数。 */
export async function simulateDiceThrow(dice: readonly TeachingDie[], random = Math.random, cancelled: () => boolean = () => false): Promise<DiceThrow> {
  const physics = await loadEngine();
  const world = new physics.World({ x: 0, y: -9.81, z: 0 });
  try {
    world.timestep = 1 / 120;
    world.createCollider(physics.ColliderDesc.cuboid(DICE_BOARD_LIMIT, 0.1, DICE_BOARD_LIMIT).setTranslation(0, -0.1, 0).setFriction(0.75).setRestitution(0.2));
    for (const sign of [-1, 1]) {
      world.createCollider(physics.ColliderDesc.cuboid(0.15, 0.3, DICE_BOARD_LIMIT).setTranslation(sign * DICE_BOARD_LIMIT, 0.3, 0).setRestitution(0.3));
      world.createCollider(physics.ColliderDesc.cuboid(DICE_BOARD_LIMIT, 0.3, 0.15).setTranslation(0, 0.3, sign * DICE_BOARD_LIMIT).setRestitution(0.3));
    }
    const bodies = dice.map((die, index) => {
      const u = random(), v = random() * Math.PI * 2, w = random() * Math.PI * 2;
      const rotation = { x: Math.sqrt(1 - u) * Math.sin(v), y: Math.sqrt(1 - u) * Math.cos(v), z: Math.sqrt(u) * Math.sin(w), w: Math.sqrt(u) * Math.cos(w) };
      const body = world.createRigidBody(physics.RigidBodyDesc.dynamic()
        .setTranslation((index % 4 - (Math.min(dice.length, 4) - 1) / 2) * 1.35, 2.2 + random() * 0.5, Math.floor(index / 4) * 1.5 - 0.75)
        .setRotation(rotation).setLinvel((random() - 0.5) * 3, random() * 2, (random() - 0.5) * 3)
        .setAngvel({ x: (random() - 0.5) * 24, y: (random() - 0.5) * 24, z: (random() - 0.5) * 24 })
        .setLinearDamping(0.3).setAngularDamping(0.35).setCcdEnabled(true).setCanSleep(true));
      world.createCollider(physics.ColliderDesc.roundCuboid(0.415, 0.415, 0.415, 0.085).setFriction(0.75).setRestitution(0.32).setDensity(1), body);
      return body;
    });
    const snapshot = () => dice.map((die, index) => ({ ...die, position: { ...bodies[index].translation() }, rotation: { ...bodies[index].rotation() }, offsets: {} }));
    const frames: TeachingDie[][] = [snapshot()];
    for (let step = 0; step < 1440; step++) {
      if (cancelled()) throw new Error("dice-throw-cancelled");
      world.step();
      if (step % 2 === 1) frames.push(snapshot());
      if (step > 120 && bodies.every((body) => body.isSleeping())) break;
      // 预计算和播放分离，定期让出主线程；轨迹仍逐帧来自刚体求解。
      if (step % 120 === 119) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const final = snapshot();
    frames.push(final);
    const settled = final.every((die, index) => worldFace(die, "y+", 0.99) !== null && die.position.y > 0.4 && Math.abs(die.position.x) < DICE_BOARD_LIMIT && Math.abs(die.position.z) < DICE_BOARD_LIMIT && bodies[index].isSleeping());
    return { frames, durationMs: (frames.length - 1) * 1000 / 60, settled };
  } finally { world.free(); }
}
export function sampleDiceThrow(throwing: DiceThrow, elapsedMs: number): TeachingDie[] {
  if (elapsedMs >= throwing.durationMs) return throwing.frames[throwing.frames.length - 1];
  if (elapsedMs <= 0) return throwing.frames[0];
  const time = Math.max(0, Math.min(throwing.frames.length - 1, elapsedMs * 60 / 1000));
  const index = Math.floor(time);
  return interpolateDice(throwing.frames[index], throwing.frames[Math.min(index + 1, throwing.frames.length - 1)], time - index);
}
