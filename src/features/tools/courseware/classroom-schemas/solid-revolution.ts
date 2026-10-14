import { toolClassroomEventSchema } from "../../scenes/classroom-envelope";
import { SOLID_REVOLUTION_VERSION, solidRevolutionSnapshotSchema } from "../../solid-revolution/contract";

export const solidRevolutionClassroomSchemas = [
  toolClassroomEventSchema("solid-revolution", SOLID_REVOLUTION_VERSION, solidRevolutionSnapshotSchema),
] as const;
