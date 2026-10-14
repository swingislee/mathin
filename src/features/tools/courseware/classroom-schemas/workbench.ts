import { z } from "zod";
import { toolClassroomEventSchema } from "../../scenes/classroom-envelope";
import { fractionSceneSchema, motionSceneSchema, FRACTION_COURSEWARE_VERSION, MOTION_COURSEWARE_VERSION } from "../numeric-teaching-content";
import { CUBE_NET_COURSEWARE_VERSION, DICE_COURSEWARE_VERSION } from "../registry";
import { diceWorkbenchStateSchema, netWorkbenchStateSchema, workbenchStateSchema } from "../workbench-classroom-contract";

export const workbenchClassroomSchemas = [
  toolClassroomEventSchema("spatial-lab", CUBE_NET_COURSEWARE_VERSION, netWorkbenchStateSchema),
  toolClassroomEventSchema("spatial-lab", DICE_COURSEWARE_VERSION, diceWorkbenchStateSchema),
  toolClassroomEventSchema("fraction-line", FRACTION_COURSEWARE_VERSION, workbenchStateSchema(fractionSceneSchema, z.never())),
  toolClassroomEventSchema("motion-lab", MOTION_COURSEWARE_VERSION, workbenchStateSchema(motionSceneSchema, z.never())),
] as const;
