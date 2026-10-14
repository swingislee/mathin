import { toolClassroomEventSchema } from "../../scenes/classroom-envelope";
import { PROJECTION_COURSEWARE_VERSION, projectionSnapshotSchema } from "../../projection/projection-contract";

export const projectionClassroomSchemas = [
  toolClassroomEventSchema("projection", PROJECTION_COURSEWARE_VERSION, projectionSnapshotSchema),
] as const;
