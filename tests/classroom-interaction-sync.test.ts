import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import type { MicrocoursePageDoc } from "@/features/courseware-doc/microcourse-schema";
import {
  createEmptyCoursewareCompositionPage,
} from "@/features/courseware-doc/composition-page-schema";
import {
  addCoursewareCompositionGame,
  addCoursewareCompositionH5,
} from "@/features/courseware-doc/composition-page-layout";
import {
  COURSEWARE_DOC_INTERACTION_AUDIT,
  MATHIN_MICROCOURSE_SYNC_PROVIDERS,
  classroomInteractionAuditIssues,
  resolveClassroomInteractionAudit,
} from "@/features/classroom/sync/interaction-audit";
import {
  CLASSROOM_GAME_MIRROR_SYNC_V1,
  CLASSROOM_SPATIAL_COMMAND_SYNC_REQUIRED_V1,
  classroomInteractionPayloadWithinBudget,
  isClassroomInteractionSyncProvider,
  type ClassroomInteractionSyncProvider,
} from "@/features/classroom/sync/interaction-provider";
import { reduceEvent, type LiveState } from "@/features/classroom/live/liveState";
import { emptyStarLedger } from "@/features/classroom/stars";
import type { GameMirrorState } from "@/features/games/types";
import { GAME_COURSEWARE_CONTRACTS } from "@/features/games/courseware/registry";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const gameDoc: GamePageDoc = {
  docVersion: "game-page-v1",
  canvas: { width: 960, height: 720, backgroundColor: "#ffffff" },
  gameId: "sudoku",
  contentVersion: "sudoku-authored-v1",
  payload: {
    kind: "authored",
    variantId: "classic-4x4",
    puzzle: new Array(16).fill(0),
    display: {
      showCoordinates: true,
      allowCandidates: true,
      allowAnswerReveal: false,
      showTeachingTools: true,
    },
  },
  validation: {
    payloadHash: "a".repeat(64),
    validatorVersion: "sudoku-authored-v1@1",
    publishable: false,
    code: "multiple",
    details: { status: "multiple", solutionCount: 2 },
  },
};

const h5Doc: MicrocoursePageDoc = {
  docVersion: "microcourse-page-v1",
  mode: "h5",
  canvas: { width: 960, height: 720, backgroundColor: "#ffffff" },
  artifactId: "11111111-1111-4111-8111-111111111111",
  sha256: "b".repeat(64),
  byteCount: 1_024,
  entryPath: "index.html",
};

const compositionGameDoc = addCoursewareCompositionGame(
  createEmptyCoursewareCompositionPage(),
  gameDoc,
);
const compositionMultiGameDoc = addCoursewareCompositionGame(compositionGameDoc, gameDoc);
const compositionH5Doc = addCoursewareCompositionH5(
  createEmptyCoursewareCompositionPage(),
  {
    artifactId: "11111111-1111-4111-8111-111111111111",
    sha256: "b".repeat(64),
    byteCount: 1_024,
    entryPath: "index.html",
  },
);

function initialState(): LiveState {
  return {
    pages: [],
    currentPage: 0,
    starLedger: emptyStarLedger(),
    started: true,
    ended: false,
    hands: {},
    boards: {},
    games: {},
    video: {},
    docSteps: {},
    openTool: null,
    quiz: null,
    answers: {},
  };
}

describe("classroom interaction synchronization audit", () => {
  it("requires an explicit decision for every courseware document family and authored mode", () => {
    expect(Object.keys(COURSEWARE_DOC_INTERACTION_AUDIT).sort()).toEqual([
      "aixuexi-page-doc-v1",
      "courseware-composition-v1",
      "game-page-v1",
      "microcourse-page-v1",
      "page-doc-v1",
      "source-runtime-page-v1",
      "spatial-page-v1",
    ]);
    expect(classroomInteractionAuditIssues()).toEqual([]);
    expect(Object.values(MATHIN_MICROCOURSE_SYNC_PROVIDERS).every(isClassroomInteractionSyncProvider)).toBe(true);
    expect(GAME_COURSEWARE_CONTRACTS.every((contract) => {
      const provider: ClassroomInteractionSyncProvider = contract.classroomSync;
      return isClassroomInteractionSyncProvider(provider) && provider.mode !== "read-only";
    })).toBe(true);
    expect(isClassroomInteractionSyncProvider({
      ...CLASSROOM_GAME_MIRROR_SYNC_V1,
      protocol: "h5-state-v1",
    })).toBe(false);
  });

  it("synchronizes authored Sudoku while keeping authored H5 and spatial pages fail-closed", () => {
    expect(resolveClassroomInteractionAudit(gameDoc)).toMatchObject({
      ownership: "mathin",
      status: "synchronized",
      provider: CLASSROOM_GAME_MIRROR_SYNC_V1,
    });
    expect(resolveClassroomInteractionAudit(h5Doc)).toMatchObject({
      ownership: "mathin",
      status: "read-only",
      provider: { protocol: "h5-state-v1", mode: "read-only" },
    });
    expect(resolveClassroomInteractionAudit(compositionGameDoc)).toMatchObject({
      surface: "composition:game-instances",
      ownership: "mathin",
      status: "synchronized",
      provider: CLASSROOM_GAME_MIRROR_SYNC_V1,
    });
    expect(resolveClassroomInteractionAudit(compositionMultiGameDoc)).toMatchObject({
      surface: "composition:game-instances",
      status: "synchronized",
      provider: CLASSROOM_GAME_MIRROR_SYNC_V1,
    });
    expect(resolveClassroomInteractionAudit(compositionH5Doc)).toMatchObject({
      surface: "composition:h5",
      ownership: "mathin",
      status: "read-only",
      provider: { protocol: "h5-state-v1", mode: "read-only" },
    });
    expect(COURSEWARE_DOC_INTERACTION_AUDIT["spatial-page-v1"].defaultProvider)
      .toBe(CLASSROOM_SPATIAL_COMMAND_SYNC_REQUIRED_V1);
    expect(CLASSROOM_SPATIAL_COMMAND_SYNC_REQUIRED_V1).toMatchObject({
      protocol: "spatial-command-v1",
      mode: "read-only",
    });
  });

  it("threads the authored game mirror into the durable classroom reducer", () => {
    const mirror: GameMirrorState = {
      values: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      selected: 0,
      candidates: new Array(16).fill(0),
      inputDigit: 1,
      entryMode: "value",
      highlightTool: "row",
      highlights: { boxes: [], rows: [0], columns: [], regions: [], focusedDigit: null },
      invalidAttempt: null,
    };
    const next = reduceEvent(initialState(), {
      id: "event-1",
      sessionId: "session-1",
      userId: "teacher-1",
      deviceId: "ipad-1",
      seq: 1,
      type: "game_state",
      payload: { pageId: "authored-sudoku-page", state: mirror },
      at: "2026-08-29T00:00:00.000Z",
    });
    expect(next.games["authored-sudoku-page"]).toEqual(mirror);
    expect(classroomInteractionPayloadWithinBudget(CLASSROOM_GAME_MIRROR_SYNC_V1, mirror)).toBe(true);

    const oversized = { ...mirror, values: new Array(40_000).fill(1) };
    expect(classroomInteractionPayloadWithinBudget(CLASSROOM_GAME_MIRROR_SYNC_V1, oversized)).toBe(false);
    expect(reduceEvent(initialState(), {
      id: "event-oversized",
      sessionId: "session-1",
      userId: "teacher-1",
      deviceId: "untrusted-device",
      seq: 1,
      type: "game_state",
      payload: { pageId: "authored-sudoku-page", state: oversized },
      at: "2026-08-29T00:00:00.000Z",
    }).games).toEqual({});

    const compositionMirror: GameMirrorState = {
      values: [],
      selected: null,
      instances: {
        "game-1": mirror,
        "game-2": { ...mirror, selected: 1 },
      },
    };
    const compositionNext = reduceEvent(initialState(), {
      id: "event-composition",
      sessionId: "session-1",
      userId: "teacher-1",
      deviceId: "ipad-1",
      seq: 2,
      type: "game_state",
      payload: { pageId: "composition-page", state: compositionMirror },
      at: "2026-08-29T00:00:01.000Z",
    });
    expect(compositionNext.games["composition-page"]?.instances?.["game-2"]?.selected).toBe(1);
  });

  it("keeps the full live adapter chain wired instead of stopping at interactive=true", () => {
    const liveShell = read("src/features/classroom/live/LiveShell.tsx");
    const docPage = read("src/features/classroom/live/DocCoursewarePage.tsx");
    const stagePreview = read("src/features/courseware-studio/StagePreview.tsx");
    const gameStage = read("src/features/games/courseware/GamePageStage.tsx");
    const sudokuStage = read("src/features/games/sudoku/SudokuGamePageStage.tsx");
    const microcourseStage = read("src/features/courseware-doc/MicrocourseStage.tsx");
    const compositionStage = read("src/features/courseware-doc/CoursewareCompositionStage.tsx");

    expect(liveShell).toContain("gameMirror={state.games[renderPage.id] ?? null}");
    expect(liveShell).toContain("onGameMirror={(mirror) => onGameMirror(renderPage.id, mirror)}");
    expect(liveShell).toContain('append("game_state"');
    expect(docPage).toContain("gameMirror={isController ? initialGameMirror : gameMirror}");
    expect(docPage).toContain("onGameMirror={isController ? onGameMirror : undefined}");
    expect(stagePreview).toContain("mirror={props.gameMirror}");
    expect(stagePreview).toContain("onMirror={props.onGameMirror}");
    expect(gameStage).toContain("mirror={mirror}");
    expect(gameStage).toContain("onMirror={onMirror}");
    expect(sudokuStage).toContain("mirror={mirror}");
    expect(sudokuStage).toContain("onMirror={onMirror}");
    expect(microcourseStage).toContain("mirror={props.gameMirror}");
    expect(microcourseStage).toContain("onMirror={props.onGameMirror}");
    expect(microcourseStage).toContain('tabIndex={props.interactive === false ? -1 : undefined}');
    expect(microcourseStage).toContain('pointerEvents: props.interactive === false ? "none" : "auto"');
    expect(compositionStage).toContain("mirror={gameInstances[block.id] ?? null}");
    expect(compositionStage).toContain("instances: next");
    expect(compositionStage).toContain("updateGameInstance(block.id, state)");
    expect(compositionStage).toContain("MicrocourseH5ArtifactFrame");
  });
});
