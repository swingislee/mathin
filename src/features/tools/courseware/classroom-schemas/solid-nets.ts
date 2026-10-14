import { toolClassroomEventSchema } from "../../scenes/classroom-envelope";
import { SOLID_NETS_LESSON_VERSION, solidNetsTeachingSnapshotSchema, SOLID_NETS_POLYHEDRA_LESSON_VERSION, solidNetsPolyhedraSnapshotSchema } from "../../solid-nets/contract";
import { SOLID_NETS_COMPLETE_VERSION, solidNetsCompleteSnapshotSchema } from "../../solid-nets/curved-contract";

export const solidNetsClassroomSchemas = [
  toolClassroomEventSchema("solid-nets", SOLID_NETS_COMPLETE_VERSION, solidNetsCompleteSnapshotSchema),
  toolClassroomEventSchema("solid-nets", SOLID_NETS_LESSON_VERSION, solidNetsTeachingSnapshotSchema),
  toolClassroomEventSchema("solid-nets", SOLID_NETS_POLYHEDRA_LESSON_VERSION, solidNetsPolyhedraSnapshotSchema),
] as const;
