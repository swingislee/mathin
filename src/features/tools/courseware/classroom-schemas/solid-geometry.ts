import { toolClassroomEventSchema } from "../../scenes/classroom-envelope";
import { SOLID_GEOMETRY_EXPLORATION_VERSION, solidGeometryExplorationSnapshotSchema } from "../../solid-geometry/exploration-contract";
import { SOLID_GEOMETRY_VERSION, solidGeometrySnapshotSchema } from "../../solid-geometry/solid-geometry-contract";

export const solidGeometryClassroomSchemas = [
  toolClassroomEventSchema("solid-geometry", SOLID_GEOMETRY_EXPLORATION_VERSION, solidGeometryExplorationSnapshotSchema),
  toolClassroomEventSchema("solid-geometry", SOLID_GEOMETRY_VERSION, solidGeometrySnapshotSchema),
] as const;
