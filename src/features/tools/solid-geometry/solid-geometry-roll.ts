import { solidEntitySchema, type SolidEntity } from "./solid-geometry-contract";
import { getSolidBounds, getSolidMeshData, solidLocalToWorld } from "./solid-geometry";
import { planSpatialRoll, spatialRollPoint, type SpatialRollDirection } from "../spatial-interaction/rolling";
import { spatialQuarterTurn } from "../spatial-interaction/rigid-motion";

/** 90° 接触棱翻滚适用于落在平面上的正方体/长方体；曲面滚动另用其真实数学模型。 */
export function solidRollTarget(entity: SolidEntity, direction: SpatialRollDirection, others: readonly SolidEntity[]) {
  if (entity.kind !== "cube" && entity.kind !== "cuboid") return null;
  const vertices = getSolidMeshData(entity).vertices.map((point) => solidLocalToWorld(point, entity));
  const bounds = getSolidBounds(entity);
  if (vertices.some((p) => (["x", "y", "z"] as const).some((axis) => Math.min(Math.abs(p[axis] - bounds.min[axis]), Math.abs(p[axis] - bounds.max[axis])) > 1e-6))) return null;
  const plan = planSpatialRoll(vertices, direction);
  if (!plan) return null;
  const target = { ...entity, position: spatialRollPoint(entity.position, plan), rotation: spatialQuarterTurn(entity.rotation, plan.axis, plan.turn) };
  if (!solidEntitySchema.safeParse(target).success) return null;
  const occupied = others.filter((other) => other.id !== entity.id).map((other) => getSolidBounds(other));
  for (let step = 0; step <= 24 && occupied.length; step++) {
    const points = vertices.map((p) => spatialRollPoint(p, plan, step / 24));
    if (occupied.some((other) => (["x", "y", "z"] as const).every((axis) => Math.max(...points.map((p) => p[axis])) > other.min[axis] + 1e-6 && Math.min(...points.map((p) => p[axis])) < other.max[axis] - 1e-6))) return null;
  }
  return { target, plan };
}
