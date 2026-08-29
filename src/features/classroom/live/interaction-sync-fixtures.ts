import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import type { CoursewarePage } from "../types";

/** Local-only formal-session fixture used by the cross-device synchronization E2E. */
export const INTERACTION_SYNC_FIXTURE_PAGE: CoursewarePage = {
  id: "classroom-interaction-sync-fixture-v1",
  type: "doc",
  docId: "classroom-interaction-sync-doc-v1",
  title: "课堂互动同步合同",
};

export const INTERACTION_SYNC_FIXTURE_DOC: GamePageDoc = {
  docVersion: "game-page-v1",
  canvas: { width: 960, height: 720, backgroundColor: "#ffffff" },
  gameId: "sudoku",
  contentVersion: "sudoku-authored-v1",
  payload: {
    kind: "authored",
    variantId: "classic-4x4",
    puzzle: [
      0, 2, 3, 4,
      3, 4, 1, 2,
      2, 1, 4, 3,
      4, 3, 2, 1,
    ],
    display: {
      showCoordinates: true,
      allowCandidates: true,
      allowAnswerReveal: false,
      showTeachingTools: true,
    },
  },
  validation: {
    payloadHash: "0".repeat(64),
    validatorVersion: "sudoku-authored-v1@1",
    publishable: true,
    code: "unique",
    details: { fixture: "classroom-interaction-sync-v1" },
  },
};
