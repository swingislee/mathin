export type DisplacementBodyKind = "cuboid" | "stepped";
export interface DisplacementTank { width: number; depth: number; height: number; waterHeight: number }
export interface DisplacementBody { kind: DisplacementBodyKind; width: number; depth: number; height: number; bottom: number }
export interface DisplacementSetup { tank: DisplacementTank; body: DisplacementBody }
export interface DisplacementBlock { x: number; y: number; z: number; width: number; height: number; depth: number }
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** 台阶物体由两个不相交的长方体组成；体积与渲染读取同一分块。 */
export function displacementBlocks(body: DisplacementBody): DisplacementBlock[] {
  const { width, height, depth } = body;
  if (body.kind === "cuboid") return [{ x: 0, y: height / 2, z: 0, width, height, depth }];
  return [
    { x: 0, y: height / 4, z: 0, width, height: height / 2, depth },
    { x: -width / 4, y: height * 3 / 4, z: 0, width: width / 2, height: height / 2, depth },
  ];
}
export function displacementBodyVolume(body: DisplacementBody): number {
  return displacementBlocks(body).reduce((sum, block) => sum + block.width * block.height * block.depth, 0);
}
export function submergedBodyVolume(body: DisplacementBody, waterHeight: number): number {
  return displacementBlocks(body).reduce((sum, block) => sum + block.width * block.depth * clamp(waterHeight - body.bottom - (block.y - block.height / 2), 0, block.height), 0);
}
export function displacementWaterVolume(tank: DisplacementTank): number { return tank.width * tank.depth * tank.waterHeight; }

/** 解 A·h − V浸入(h) = V水；物体截面小于水箱，左侧严格递增。 */
export function solveDisplacement(setup: DisplacementSetup) {
  const { tank, body } = setup, area = tank.width * tank.depth, waterVolume = displacementWaterVolume(tank);
  let low = tank.waterHeight, high = tank.height + body.height;
  for (let i = 0; i < 60; i++) {
    const height = (low + high) / 2;
    if (area * height - submergedBodyVolume(body, height) < waterVolume) low = height; else high = height;
  }
  const waterHeight = (low + high) / 2, displacedVolume = submergedBodyVolume(body, waterHeight), bodyVolume = displacementBodyVolume(body);
  return { waterHeight, displacedVolume, bodyVolume, waterVolume, rise: waterHeight - tank.waterHeight,
    fullySubmerged: displacedVolume >= bodyVolume - 1e-8, dry: displacedVolume < 1e-8, overflow: waterHeight > tank.height + 1e-8 };
}
export function displacementMinimumBottom(setup: DisplacementSetup): number {
  const { tank, body } = setup, spare = tank.width * tank.depth * (tank.height - tank.waterHeight);
  if (submergedBodyVolume({ ...body, bottom: 0 }, tank.height) <= spare + 1e-10) return 0;
  let low = 0, high = tank.height;
  for (let i = 0; i < 60; i++) {
    const bottom = (low + high) / 2;
    if (submergedBodyVolume({ ...body, bottom }, tank.height) > spare) low = bottom; else high = bottom;
  }
  return high;
}
export type DisplacementLimit = "rim" | "floor" | "ceiling" | null;
/** 手柄、数值和演示按钮调用同一落点；到箱口就停，液量始终留在箱内。 */
export function placeDisplacementBody<S extends DisplacementSetup>(state: S, requested: number): { state: S; limit: DisplacementLimit } {
  if (!Number.isFinite(requested)) return { state, limit: null };
  const min = displacementMinimumBottom(state), max = state.tank.height + 1;
  const bottom = clamp(requested, min, max);
  return { state: { ...state, body: { ...state.body, bottom } }, limit: requested < min - 1e-8 ? min > 1e-8 ? "rim" : "floor" : requested > max ? "ceiling" : null };
}
export function displacementBottomAtFraction(state: DisplacementSetup, fraction: number): number {
  const targetVolume = displacementBodyVolume(state.body) * clamp(fraction, 0, 1);
  const height = state.tank.waterHeight + targetVolume / (state.tank.width * state.tank.depth);
  let low = height - state.body.height, high = height;
  for (let i = 0; i < 60; i++) {
    const bottom = (low + high) / 2;
    if (submergedBodyVolume({ ...state.body, bottom }, height) > targetVolume) low = bottom; else high = bottom;
  }
  return (low + high) / 2;
}
export function displacementConfigurationKey(state: DisplacementSetup): string {
  return JSON.stringify([state.tank, state.body.kind, state.body.width, state.body.depth, state.body.height]);
}
