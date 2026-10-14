import type { z } from "zod";
import { CLASSROOM_TOOL_STATE_SYNC_V1, classroomInteractionPayloadWithinBudget } from "@/features/classroom/sync/interaction-provider";
import { ALL_PLANAR_TOOLS } from "../planar-kit/catalog";
import { toolClassroomEnvelopeSchema, toolSceneInstanceKey, toolSceneOriginHash, type ToolClassroomEnvelope } from "../scenes/classroom-envelope";
import { FRACTION_COURSEWARE_VERSION, MOTION_COURSEWARE_VERSION } from "../scenes/numeric-teaching-content";
import {
  CUBE_COURSEWARE_CONTENT_VERSION, CUBE_NET_COURSEWARE_VERSION, CUBE_NET_EXPLORATION_COURSEWARE_VERSION, CUBE_ROTATION_COURSEWARE_VERSION,
  DICE_COURSEWARE_VERSION, NET_TEACHING_COURSEWARE_VERSION, PLACE_VALUE_COURSEWARE_VERSION, PLACE_VALUE_LEGACY_COURSEWARE_VERSION,
  PLACE_VALUE_MAPPING_COURSEWARE_VERSION, PROJECTION_COURSEWARE_VERSION, SOLID_CAPACITY_COURSEWARE_VERSION, SOLID_CAPACITY_TEACHING_COURSEWARE_VERSION,
  SOLID_GEOMETRY_COURSEWARE_VERSION, SOLID_GEOMETRY_EXPLORATION_COURSEWARE_VERSION, SOLID_NETS_COMPLETE_COURSEWARE_VERSION,
  SOLID_NETS_COURSEWARE_VERSION, SOLID_NETS_POLYHEDRA_COURSEWARE_VERSION, SOLID_REVOLUTION_COURSEWARE_VERSION, SOMA_COURSEWARE_LEGACY_VERSION,
  SOMA_COURSEWARE_VERSION,
} from "../scenes/registry";
import type { ToolScene } from "../scenes/contract";
import type { ClassroomToolStatePayload, ClassroomToolUpdate } from "./tool-classroom";

/**
 * 课堂页的工具状态入口。外壳（页面、课件、实例与版本）同步校验，用于路由、去重和重放；
 * 各工具的严格状态合同按课件实际用到的工具族加载，状态经合同校验后才交给工具，
 * 本机发出的状态同样先校验再广播。课件里没有的工具，其代码不进入课堂页。
 */
type EventSchema = z.ZodType<ClassroomToolStatePayload> & { shape: { toolId: { value: string }; contentVersion: { value: string } } };
const FAMILIES = {
  planar: () => import("../planar-kit/classroom").then((module) => module.planarClassroomSchemas),
  placeValue: () => import("./classroom-schemas/place-value").then((module) => module.placeValueClassroomSchemas),
  solidNets: () => import("./classroom-schemas/solid-nets").then((module) => module.solidNetsClassroomSchemas),
  solidCapacity: () => import("./classroom-schemas/solid-capacity").then((module) => module.solidCapacityClassroomSchemas),
  solidGeometry: () => import("./classroom-schemas/solid-geometry").then((module) => module.solidGeometryClassroomSchemas),
  solidRevolution: () => import("./classroom-schemas/solid-revolution").then((module) => module.solidRevolutionClassroomSchemas),
  cube: () => import("./classroom-schemas/cube").then((module) => module.cubeClassroomSchemas),
  workbench: () => import("./classroom-schemas/workbench").then((module) => module.workbenchClassroomSchemas),
  projection: () => import("./classroom-schemas/projection").then((module) => module.projectionClassroomSchemas),
  netTeaching: () => import("./classroom-schemas/net-teaching").then((module) => module.netTeachingClassroomSchemas),
  soma: () => import("./classroom-schemas/soma").then((module) => module.somaClassroomSchemas),
} satisfies Record<string, () => Promise<readonly unknown[]>>;
type Family = keyof typeof FAMILIES;

const adapterKey = (toolId: string, contentVersion: string) => `${toolId}\n${contentVersion}`;
// 与 tool-classroom 的完整合同一一对应；tests/classroom-tool-runtime.test.ts 核对两者集合一致。
const ADAPTERS = new Map<string, Family>([
  ...ALL_PLANAR_TOOLS.map((tool) => [adapterKey(tool.id, tool.version), "planar"] as const),
  [adapterKey("place-value", PLACE_VALUE_COURSEWARE_VERSION), "placeValue"],
  [adapterKey("place-value", PLACE_VALUE_MAPPING_COURSEWARE_VERSION), "placeValue"],
  [adapterKey("place-value", PLACE_VALUE_LEGACY_COURSEWARE_VERSION), "placeValue"],
  [adapterKey("solid-nets", SOLID_NETS_COMPLETE_COURSEWARE_VERSION), "solidNets"],
  [adapterKey("solid-nets", SOLID_NETS_COURSEWARE_VERSION), "solidNets"],
  [adapterKey("solid-nets", SOLID_NETS_POLYHEDRA_COURSEWARE_VERSION), "solidNets"],
  [adapterKey("solid-capacity", SOLID_CAPACITY_TEACHING_COURSEWARE_VERSION), "solidCapacity"],
  [adapterKey("solid-capacity", SOLID_CAPACITY_COURSEWARE_VERSION), "solidCapacity"],
  [adapterKey("solid-geometry", SOLID_GEOMETRY_EXPLORATION_COURSEWARE_VERSION), "solidGeometry"],
  [adapterKey("solid-geometry", SOLID_GEOMETRY_COURSEWARE_VERSION), "solidGeometry"],
  [adapterKey("solid-revolution", SOLID_REVOLUTION_COURSEWARE_VERSION), "solidRevolution"],
  [adapterKey("spatial-lab", CUBE_COURSEWARE_CONTENT_VERSION), "cube"],
  [adapterKey("spatial-lab", CUBE_ROTATION_COURSEWARE_VERSION), "cube"],
  [adapterKey("spatial-lab", CUBE_NET_COURSEWARE_VERSION), "workbench"],
  [adapterKey("spatial-lab", DICE_COURSEWARE_VERSION), "workbench"],
  [adapterKey("fraction-line", FRACTION_COURSEWARE_VERSION), "workbench"],
  [adapterKey("motion-lab", MOTION_COURSEWARE_VERSION), "workbench"],
  [adapterKey("projection", PROJECTION_COURSEWARE_VERSION), "projection"],
  [adapterKey("spatial-lab", NET_TEACHING_COURSEWARE_VERSION), "netTeaching"],
  [adapterKey("spatial-lab", CUBE_NET_EXPLORATION_COURSEWARE_VERSION), "netTeaching"],
  [adapterKey("soma-cube", SOMA_COURSEWARE_VERSION), "soma"],
  [adapterKey("soma-cube", SOMA_COURSEWARE_LEGACY_VERSION), "soma"],
]);

/** 课堂内仅按外壳识别的工具状态；state 未经工具合同校验，不能直接交给工具。 */
export type ClassroomToolEnvelope = ToolClassroomEnvelope;
export interface ClassroomToolStateEntry { readonly payload: ClassroomToolEnvelope | ClassroomToolStatePayload; readonly sequences: Readonly<Record<string, number>> }
export type ClassroomToolStates = Readonly<Record<string, ClassroomToolStateEntry>>;

export const coursewareToolOriginHash = toolSceneOriginHash;
export const classroomToolInstanceKey = toolSceneInstanceKey;

export function hasClassroomToolAdapter(tool: { toolId: string; contentVersion: string }) {
  return ADAPTERS.has(adapterKey(tool.toolId, tool.contentVersion));
}

const SCENE_VERSIONS = new Set([...ADAPTERS.keys()].map((key) => key.split("\n")[1]));
/** 与 scenes/contract 的 isToolScene 相同（工具现场与课堂合同版本集合一致），供渲染分派使用。 */
export function isToolSceneVersion(value: { contentVersion: string }): value is ToolScene {
  return SCENE_VERSIONS.has(value.contentVersion);
}

/** 已登记的严格合同键（测试核对与完整合同一致）。 */
export function classroomToolAdapterKeys(): readonly string[] {
  return [...ADAPTERS.keys()];
}

const contracts = new Map<string, EventSchema>();
const loading = new Map<Family, Promise<void>>();

/** 完整合同模块加载时一次登记全部工具；之后的校验与旧同步接口一致。 */
export function registerClassroomToolContracts(schemas: readonly unknown[]) {
  for (const schema of schemas as readonly EventSchema[]) contracts.set(adapterKey(schema.shape.toolId.value, schema.shape.contentVersion.value), schema);
}

/** 加载该工具所属工具族的严格合同；未登记的工具返回 false。 */
export function loadClassroomToolContract(tool: { toolId: string; contentVersion: string }): Promise<boolean> {
  const key = adapterKey(tool.toolId, tool.contentVersion);
  const family = ADAPTERS.get(key);
  if (!family) return Promise.resolve(false);
  if (contracts.has(key)) return Promise.resolve(true);
  let task = loading.get(family);
  if (!task) {
    task = FAMILIES[family]().then(registerClassroomToolContracts);
    loading.set(family, task);
    task.catch(() => loading.delete(family));
  }
  return task.then(() => contracts.has(key));
}

export function isClassroomToolContractLoaded(tool: { toolId: string; contentVersion: string }) {
  return contracts.has(adapterKey(tool.toolId, tool.contentVersion));
}

/** 外壳校验：预算、外壳字段与已登记的工具版本。 */
export function parseClassroomToolEnvelope(value: unknown): ClassroomToolEnvelope | null {
  if (!classroomInteractionPayloadWithinBudget(CLASSROOM_TOOL_STATE_SYNC_V1, value)) return null;
  const result = toolClassroomEnvelopeSchema.safeParse(value);
  return result.success && hasClassroomToolAdapter(result.data) ? result.data : null;
}

/** 严格校验：合同已加载时返回校验结果或 null；合同尚未加载时返回 undefined。 */
export function verifyClassroomToolState(value: ClassroomToolEnvelope | ClassroomToolStatePayload): ClassroomToolStatePayload | null | undefined {
  const schema = contracts.get(adapterKey(value.toolId, value.contentVersion));
  if (!schema) return hasClassroomToolAdapter(value) ? undefined : null;
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * 课堂状态机与重放接收的工具状态：外壳无效或合同已加载且校验失败时拒绝；
 * 合同尚未加载时先按外壳保存，交给工具前再严格校验。
 */
export function acceptClassroomToolState(value: unknown): ClassroomToolEnvelope | ClassroomToolStatePayload | null {
  const envelope = parseClassroomToolEnvelope(value);
  if (!envelope) return null;
  const verified = verifyClassroomToolState(envelope);
  return verified === undefined ? envelope : verified;
}

/** 本机发出的工具状态：加载合同后严格校验，再交给事件日志。 */
export async function createVerifiedClassroomToolState(
  pageId: string, docId: string, instanceId: string, update: ClassroomToolUpdate, originHash: string,
): Promise<ClassroomToolStatePayload> {
  await loadClassroomToolContract(update);
  const envelope = parseClassroomToolEnvelope({ toolId: update.toolId, contentVersion: update.contentVersion, state: update.state,
    schema: "mathin-classroom-tool-state", version: 1, pageId, docId, instanceId, originHash });
  const payload = envelope ? verifyClassroomToolState(envelope) : null;
  if (!payload) throw new Error("CLASSROOM_TOOL_STATE_INVALID_OR_TOO_LARGE");
  return payload;
}
