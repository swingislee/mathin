import { toolClassroomEventSchema } from "../../scenes/classroom-envelope";
import { PLACE_VALUE_VERSION, placeValueSnapshotSchema } from "../../place-value/contract";
import { PLACE_VALUE_MAPPING_VERSION, placeValueMappingSnapshotSchema, PLACE_VALUE_VERSION as RADIX_PLACE_VALUE_VERSION, placeValueSnapshotSchema as radixPlaceValueSnapshotSchema } from "../../place-value/radix-contract";

export const placeValueClassroomSchemas = [
  toolClassroomEventSchema("place-value", RADIX_PLACE_VALUE_VERSION, radixPlaceValueSnapshotSchema),
  toolClassroomEventSchema("place-value", PLACE_VALUE_MAPPING_VERSION, placeValueMappingSnapshotSchema),
  toolClassroomEventSchema("place-value", PLACE_VALUE_VERSION, placeValueSnapshotSchema),
] as const;
