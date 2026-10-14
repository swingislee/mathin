import { toolClassroomEventSchema } from "../../scenes/classroom-envelope";
import { SOLID_CAPACITY_VERSION, solidCapacitySnapshotSchema } from "../../solid-capacity/solid-capacity-contract";
import { SOLID_CAPACITY_TEACHING_VERSION, solidCapacityTeachingSnapshotSchema } from "../../solid-capacity/solid-capacity-teaching-contract";

export const solidCapacityClassroomSchemas = [
  toolClassroomEventSchema("solid-capacity", SOLID_CAPACITY_TEACHING_VERSION, solidCapacityTeachingSnapshotSchema),
  toolClassroomEventSchema("solid-capacity", SOLID_CAPACITY_VERSION, solidCapacitySnapshotSchema),
] as const;
