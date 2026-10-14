import { z } from "zod";
import { CLASSROOM_TOOL_STATE_SYNC_V1, classroomInteractionPayloadWithinBudget } from "@/features/classroom/sync/interaction-provider";
import type { CubeClassroomSnapshot } from "./cube-structures-classroom";
import { planarClassroomSchemas } from "../planar-kit/classroom";
import { cubeClassroomSchemas } from "./classroom-schemas/cube";
import { netTeachingClassroomSchemas } from "./classroom-schemas/net-teaching";
import { placeValueClassroomSchemas } from "./classroom-schemas/place-value";
import { projectionClassroomSchemas } from "./classroom-schemas/projection";
import { solidCapacityClassroomSchemas } from "./classroom-schemas/solid-capacity";
import { solidGeometryClassroomSchemas } from "./classroom-schemas/solid-geometry";
import { solidNetsClassroomSchemas } from "./classroom-schemas/solid-nets";
import { solidRevolutionClassroomSchemas } from "./classroom-schemas/solid-revolution";
import { somaClassroomSchemas } from "./classroom-schemas/soma";
import { workbenchClassroomSchemas } from "./classroom-schemas/workbench";
import { registerClassroomToolContracts, type ClassroomToolStates } from "./tool-classroom-runtime";

export {
  classroomToolInstanceKey, coursewareToolOriginHash, hasClassroomToolAdapter,
  type ClassroomToolEnvelope, type ClassroomToolStateEntry, type ClassroomToolStates,
} from "./tool-classroom-runtime";

// 工具只在这里登记严格状态/动作合同。传输、课堂入口与实例状态容器不再识别具体工具。
// 各工具族合同分文件保存：本模块汇总全部合同供测试、编辑端与服务端使用；
// 课堂页经 tool-classroom-runtime 只按需加载课件实际用到的工具族。
export const classroomToolEventSchema = z.discriminatedUnion("contentVersion", [
  ...planarClassroomSchemas,
  ...placeValueClassroomSchemas,
  ...solidNetsClassroomSchemas,
  ...solidCapacityClassroomSchemas,
  ...solidGeometryClassroomSchemas,
  ...solidRevolutionClassroomSchemas,
  ...cubeClassroomSchemas,
  ...workbenchClassroomSchemas,
  ...projectionClassroomSchemas,
  ...netTeachingClassroomSchemas,
  ...somaClassroomSchemas,
]);
registerClassroomToolContracts(classroomToolEventSchema.options);
export type ClassroomToolStatePayload = z.infer<typeof classroomToolEventSchema>;
export type ClassroomToolUpdate = ClassroomToolStatePayload extends infer P ? P extends ClassroomToolStatePayload
  ? P extends { contentVersion: "cube-structures-lesson-v2" | "cube-structures-lesson-v3" } ? Pick<P, "toolId" | "contentVersion"> & { state: CubeClassroomSnapshot }
    : Pick<P, "toolId" | "contentVersion" | "state"> : never : never;
export interface ClassroomToolRuntime {
  readonly pageId: string; readonly docId: string; readonly states: ClassroomToolStates;
  readonly onChange?: (instanceId: string, originHash: string, update: ClassroomToolUpdate) => Promise<void>;
}
export interface CoursewareToolRuntime {
  readonly state?: ClassroomToolUpdate;
  readonly onChange?: (update: ClassroomToolUpdate) => Promise<void>;
}
export function parseClassroomToolState(value: unknown): ClassroomToolStatePayload | null {
  if (!classroomInteractionPayloadWithinBudget(CLASSROOM_TOOL_STATE_SYNC_V1, value)) return null;
  const result = classroomToolEventSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function createClassroomToolState(pageId: string, docId: string, instanceId: string, update: ClassroomToolUpdate, originHash: string): ClassroomToolStatePayload {
  const payload = parseClassroomToolState({ toolId: update.toolId, contentVersion: update.contentVersion, state: update.state,
    schema: "mathin-classroom-tool-state", version: 1, pageId, docId, instanceId, originHash });
  if (!payload) throw new Error("CLASSROOM_TOOL_STATE_INVALID_OR_TOO_LARGE");
  return payload;
}
