import {
  CLASSROOM_GAME_MIRROR_SYNC_V1,
  type ClassroomInteractionSyncProvider,
} from "@/features/classroom/sync/interaction-provider";

interface GameCoursewareContractDefinition {
  gameId: string;
  contentVersion: string;
  validatorVersion: string;
  authoringSurfaces: readonly ["microcourse", ...string[]];
  copyable: boolean;
  classroomSync: ClassroomInteractionSyncProvider;
}

export const GAME_COURSEWARE_CONTRACTS = [
  {
    gameId: "sudoku",
    contentVersion: "sudoku-authored-v1",
    validatorVersion: "sudoku-authored-v1@1",
    authoringSurfaces: ["microcourse"] as const,
    copyable: true,
    classroomSync: CLASSROOM_GAME_MIRROR_SYNC_V1,
  },
] as const satisfies readonly GameCoursewareContractDefinition[];

export type GameCoursewareContract = (typeof GAME_COURSEWARE_CONTRACTS)[number];
export type AuthorableGameId = GameCoursewareContract["gameId"];
export type GameCoursewareContentVersion = GameCoursewareContract["contentVersion"];
export type GameCoursewareAuthoringSurface = GameCoursewareContract["authoringSurfaces"][number];

export function getGameCoursewareContract(
  gameId: string,
  contentVersion: string,
): GameCoursewareContract | undefined {
  return GAME_COURSEWARE_CONTRACTS.find((contract) => (
    contract.gameId === gameId && contract.contentVersion === contentVersion
  ));
}

export function gameCoursewareContractsForSurface(
  surface: GameCoursewareAuthoringSurface,
): readonly GameCoursewareContract[] {
  return GAME_COURSEWARE_CONTRACTS.filter((contract) => (
    (contract.authoringSurfaces as readonly GameCoursewareAuthoringSurface[]).includes(surface)
  ));
}
