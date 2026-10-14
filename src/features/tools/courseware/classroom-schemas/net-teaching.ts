import { toolClassroomEventSchema } from "../../scenes/classroom-envelope";
import { CUBE_NET_EXPLORATION_VERSION, cubeNetExplorationStateSchema, NET_TEACHING_VERSION, netTeachingStateSchema } from "../../net-teaching/contract";

export const netTeachingClassroomSchemas = [
  toolClassroomEventSchema("spatial-lab", NET_TEACHING_VERSION, netTeachingStateSchema),
  toolClassroomEventSchema("spatial-lab", CUBE_NET_EXPLORATION_VERSION, cubeNetExplorationStateSchema),
] as const;
