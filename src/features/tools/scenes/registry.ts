import {
  CLASSROOM_TOOL_STATE_SYNC_REQUIRED_V1,
  CLASSROOM_TOOL_STATE_SYNC_V1,
  type ClassroomInteractionSyncProvider,
} from "@/features/classroom/sync/interaction-provider";
import { FRACTION_COURSEWARE_VERSION, MOTION_COURSEWARE_VERSION } from "./numeric-teaching-content";

export const TOOL_COURSEWARE_CONTENT_VERSION = "tool-embed-v1" as const;
export const CUBE_COURSEWARE_LEGACY_VERSION = "cube-structures-lesson-v1" as const;
export const CUBE_COURSEWARE_CONTENT_VERSION = "cube-structures-lesson-v2" as const;
export const CUBE_ROTATION_COURSEWARE_VERSION = "cube-structures-lesson-v3" as const;
export const CUBE_NET_COURSEWARE_VERSION = "cube-net-lesson-v1" as const;
export const NET_TEACHING_COURSEWARE_VERSION = "cube-net-lesson-v2" as const;
export const DICE_COURSEWARE_VERSION = "dice-lesson-v1" as const;
export const PROJECTION_COURSEWARE_VERSION = "projection-lesson-v1" as const;
export const SOLID_GEOMETRY_COURSEWARE_VERSION = "solid-geometry-lesson-v1" as const;
export const SOLID_CAPACITY_COURSEWARE_VERSION = "solid-capacity-lesson-v1" as const;

export type ToolCoursewareAuthoringSurface = "microcourse" | "formal-courseware";

/** Tools 统一能力目录；课件是消费者之一，旧内容版本继续保留自己的 wire identity。 */
interface ToolCoursewareContractDefinition {
  toolId: string;
  catalogId?: string;
  contentVersion: typeof TOOL_COURSEWARE_CONTENT_VERSION | typeof CUBE_COURSEWARE_CONTENT_VERSION | typeof CUBE_ROTATION_COURSEWARE_VERSION | typeof CUBE_COURSEWARE_LEGACY_VERSION | typeof CUBE_NET_COURSEWARE_VERSION | typeof NET_TEACHING_COURSEWARE_VERSION | typeof DICE_COURSEWARE_VERSION | typeof FRACTION_COURSEWARE_VERSION | typeof MOTION_COURSEWARE_VERSION | typeof PROJECTION_COURSEWARE_VERSION | typeof SOLID_GEOMETRY_COURSEWARE_VERSION | typeof SOLID_CAPACITY_COURSEWARE_VERSION;
  authoringSurfaces: readonly ToolCoursewareAuthoringSurface[];
  classroomSync: ClassroomInteractionSyncProvider;
}

export const TOOL_COURSEWARE_CONTRACTS = [
  {
    toolId: "spatial-lab", contentVersion: CUBE_ROTATION_COURSEWARE_VERSION,
    catalogId: "cube-structures", authoringSurfaces: ["microcourse", "formal-courseware"] as const,
    classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "spatial-lab",
    contentVersion: CUBE_COURSEWARE_CONTENT_VERSION,
    catalogId: "cube-structures",
    authoringSurfaces: ["microcourse", "formal-courseware"] as const,
    classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "spatial-lab", contentVersion: NET_TEACHING_COURSEWARE_VERSION,
    catalogId: "cube-net", authoringSurfaces: ["microcourse", "formal-courseware"] as const, classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "spatial-lab", contentVersion: CUBE_NET_COURSEWARE_VERSION,
    catalogId: "cube-net",
    authoringSurfaces: ["microcourse", "formal-courseware"] as const,
    classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "spatial-lab", contentVersion: DICE_COURSEWARE_VERSION,
    catalogId: "dice",
    authoringSurfaces: ["microcourse", "formal-courseware"] as const,
    classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "fraction-line", catalogId: "fraction-line", contentVersion: FRACTION_COURSEWARE_VERSION,
    authoringSurfaces: ["microcourse", "formal-courseware"] as const, classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "motion-lab", catalogId: "motion-lab", contentVersion: MOTION_COURSEWARE_VERSION,
    authoringSurfaces: ["microcourse", "formal-courseware"] as const, classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "projection", catalogId: "projection", contentVersion: PROJECTION_COURSEWARE_VERSION,
    authoringSurfaces: ["microcourse", "formal-courseware"] as const, classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "solid-geometry", catalogId: "solid-geometry", contentVersion: SOLID_GEOMETRY_COURSEWARE_VERSION,
    authoringSurfaces: ["microcourse", "formal-courseware"] as const, classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "solid-capacity", catalogId: "solid-capacity", contentVersion: SOLID_CAPACITY_COURSEWARE_VERSION,
    authoringSurfaces: ["microcourse", "formal-courseware"] as const, classroomSync: CLASSROOM_TOOL_STATE_SYNC_V1,
  },
  {
    toolId: "spatial-lab",
    contentVersion: CUBE_COURSEWARE_LEGACY_VERSION,
    authoringSurfaces: ["microcourse"] as const,
    classroomSync: CLASSROOM_TOOL_STATE_SYNC_REQUIRED_V1,
  },
  {
    toolId: "fraction-line",
    contentVersion: TOOL_COURSEWARE_CONTENT_VERSION,
    authoringSurfaces: ["microcourse"] as const,
    classroomSync: CLASSROOM_TOOL_STATE_SYNC_REQUIRED_V1,
  },
  {
    toolId: "motion-lab",
    contentVersion: TOOL_COURSEWARE_CONTENT_VERSION,
    authoringSurfaces: ["microcourse"] as const,
    classroomSync: CLASSROOM_TOOL_STATE_SYNC_REQUIRED_V1,
  },
  {
    toolId: "spatial-lab",
    contentVersion: TOOL_COURSEWARE_CONTENT_VERSION,
    authoringSurfaces: ["microcourse"] as const,
    classroomSync: CLASSROOM_TOOL_STATE_SYNC_REQUIRED_V1,
  },
] as const satisfies readonly ToolCoursewareContractDefinition[];

export type ToolCoursewareContract = (typeof TOOL_COURSEWARE_CONTRACTS)[number];

export function getToolCoursewareContract(
  toolId: string,
  contentVersion: string,
): ToolCoursewareContract | undefined {
  return TOOL_COURSEWARE_CONTRACTS.find((contract) => (
    contract.toolId === toolId && contract.contentVersion === contentVersion
  ));
}

export function toolCoursewareContractsForSurface(
  surface: ToolCoursewareAuthoringSurface,
): readonly ToolSceneDefinition[] {
  const seen = new Set<string>();
  return TOOL_SCENE_DEFINITIONS.filter((contract) => {
    if (!(contract.authoringSurfaces as readonly ToolCoursewareAuthoringSurface[]).includes(surface) || seen.has(contract.catalogId)) return false;
    seen.add(contract.catalogId);
    return true;
  });
}

export const TOOL_SCENE_DEFINITIONS = TOOL_COURSEWARE_CONTRACTS.filter((definition) => "catalogId" in definition);
export type ToolSceneDefinition = (typeof TOOL_SCENE_DEFINITIONS)[number];
export function getToolSceneDefinition(catalogId: string) {
  return TOOL_SCENE_DEFINITIONS.find((definition) => definition.catalogId === catalogId);
}
