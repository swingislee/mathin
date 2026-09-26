import { toolClassroomEventSchema } from "../scenes/classroom-envelope";
import { PLANAR_TOOLS, planarSnapshotForTool, type PlanarToolId, type PlanarVersion } from "./contract";

function eventSchema<I extends PlanarToolId, V extends PlanarVersion>(id: I, version: V) {
  return toolClassroomEventSchema(id, version, planarSnapshotForTool(id));
}
type EventSchemas<T extends readonly (typeof PLANAR_TOOLS)[number][]> = {
  [K in keyof T]: ReturnType<typeof eventSchema<T[K]["id"], T[K]["version"]>>
};
export const planarClassroomSchemas = PLANAR_TOOLS.map((tool) => eventSchema(tool.id, tool.version)) as unknown as EventSchemas<typeof PLANAR_TOOLS>;
