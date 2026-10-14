import { toolClassroomEventSchema } from "../../scenes/classroom-envelope";
import { SOMA_VERSION, SOMA_LEGACY_VERSION, somaSnapshotSchema, somaLegacySnapshotSchema } from "../../soma-cube/contract";

export const somaClassroomSchemas = [
  toolClassroomEventSchema("soma-cube", SOMA_VERSION, somaSnapshotSchema),
  toolClassroomEventSchema("soma-cube", SOMA_LEGACY_VERSION, somaLegacySnapshotSchema),
] as const;
