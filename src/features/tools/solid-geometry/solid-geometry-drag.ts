import { cubeFrame, type CubeStructureState } from "../spatial-lab/cube-structures-contract";
import type { CubeMoveOperation } from "../spatial-lab/cube-structures-drag";
import { solidEntitySchema, type SolidEntity } from "./solid-geometry-contract";

/** 单点代理仅服务已验收的轴向拖动控件；实体几何、尺寸和数学量仍来自实体参数。 */
export function solidDragState(entities: readonly SolidEntity[]): CubeStructureState {
  const cubes = entities.map((entity) => ({ id: entity.id, position: entity.position, color: entity.color, faces: {} }));
  return { cubes, hiddenCubeIds: [], groups: [], origin: null, axesVisible: false, view: "angle", frame: cubeFrame(cubes), nextCubeId: 1, nextNumber: 1, hiddenEdgesVisible: false };
}
export function moveSolidByDrag(entities: readonly SolidEntity[], operation: CubeMoveOperation): SolidEntity[] | null {
  if (operation.ids.length !== 1 || !Number.isFinite(operation.distance) || Math.abs(operation.distance) < 1e-9) return null;
  const selected = entities.find((entity) => entity.id === operation.ids[0]); if (!selected) return null;
  const next = { ...selected, position: { ...selected.position, [operation.axis]: selected.position[operation.axis] + operation.distance } };
  if (!solidEntitySchema.safeParse(next).success) return null;
  return entities.map((entity) => entity.id === selected.id ? next : entity);
}
