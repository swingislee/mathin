import {
  CLASSROOM_TOOL_STATE_SYNC_REQUIRED_V1,
  type ClassroomInteractionSyncProvider,
} from "@/features/classroom/sync/interaction-provider";

export const TOOL_COURSEWARE_CONTENT_VERSION = "tool-embed-v1" as const;

export type ToolCoursewareAuthoringSurface = "microcourse";

interface ToolCoursewareContractDefinition {
  toolId: string;
  contentVersion: typeof TOOL_COURSEWARE_CONTENT_VERSION;
  authoringSurfaces: readonly ToolCoursewareAuthoringSurface[];
  classroomSync: ClassroomInteractionSyncProvider;
}

export const TOOL_COURSEWARE_CONTRACTS = [
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
): readonly ToolCoursewareContract[] {
  return TOOL_COURSEWARE_CONTRACTS.filter((contract) => (
    (contract.authoringSurfaces as readonly ToolCoursewareAuthoringSurface[]).includes(surface)
  ));
}
