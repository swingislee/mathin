export const GAME_COURSEWARE_CONTRACTS = [
  {
    gameId: "sudoku",
    contentVersion: "sudoku-authored-v1",
    validatorVersion: "sudoku-authored-v1@1",
    authoringSurfaces: ["microcourse"] as const,
    copyable: true,
  },
] as const;

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

