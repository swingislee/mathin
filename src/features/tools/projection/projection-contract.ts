import { z } from "zod";
import { cubeStructureStateSchema } from "../spatial-lab/cube-structures-draft";
import { createCubeHistory, type CubeStructureState } from "../spatial-lab/cube-structures-contract";
import { cubeSnapshotHistory } from "../spatial-lab/cube-structures-session";
import { cubeClassroomSnapshotSchema, type CubeClassroomSnapshot } from "../courseware/cube-structures-classroom";
import { PROJECTION_COURSEWARE_VERSION } from "../scenes/registry";

export { PROJECTION_COURSEWARE_VERSION } from "../scenes/registry";
export const PROJECTION_VIEWS = ["front", "right", "top"] as const;
export type ProjectionView = (typeof PROJECTION_VIEWS)[number];
const options = {
  views: z.array(z.enum(PROJECTION_VIEWS)).max(3).refine((views) => new Set(views).size === views.length),
  guides: z.boolean(),
};
export const projectionInitialSchema = z.object({ structure: cubeStructureStateSchema, ...options }).strict();
export type ProjectionInitial = z.infer<typeof projectionInitialSchema>;
export const projectionToolSchema = z.object({
  toolId: z.literal("projection"), contentVersion: z.literal(PROJECTION_COURSEWARE_VERSION),
  payload: z.object({ title: z.string().trim().min(1).max(80), initial: projectionInitialSchema }).strict(),
}).strict();

export interface ProjectionSnapshot {
  readonly cube: CubeClassroomSnapshot;
  readonly views: readonly ProjectionView[];
  readonly guides: boolean;
}
export const projectionSnapshotSchema: z.ZodType<ProjectionSnapshot> = z.object({ cube: cubeClassroomSnapshotSchema, ...options }).strict();

export function createProjectionInitial(): ProjectionInitial {
  return projectionInitialSchema.parse({ structure: createCubeHistory([
    { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 },
  ]).initial, views: [...PROJECTION_VIEWS], guides: false });
}
export function projectionSnapshot(initial: ProjectionInitial): ProjectionSnapshot {
  return { cube: { session: { work: cubeSnapshotHistory(initial.structure), lesson: null, recording: "off", preview: null }, view: null, cameraRevision: 0 },
    views: initial.views, guides: initial.guides };
}
/** 冻结当前结构和投影条件，课堂历史与自由镜头不进入备课副本。 */
export function projectionInitial(snapshot: ProjectionSnapshot, structure: CubeStructureState): ProjectionInitial {
  return projectionInitialSchema.parse({ structure: { ...structure, view: snapshot.cube.view ?? structure.view }, views: snapshot.views, guides: snapshot.guides });
}
