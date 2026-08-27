import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCoursewareDoc } from "@/features/courseware-doc/document";
import { gamePageDocSchema } from "@/features/courseware-doc/game-page-schema";
import {
  MICROCOURSE_H5_MAX_BYTES,
  MICROCOURSE_PAGE_DOC_VERSION,
  microcoursePageDocSchema,
} from "@/features/courseware-doc/microcourse-schema";
import { MICROCOURSE_H5_CSP, microcourseH5SecurityHeaders } from "@/features/courseware-doc/h5-shim";
import {
  analyzeSudokuPuzzle,
  isValidPartialSudokuGrid,
  type SudokuGrid,
} from "@/features/games/sudoku/logic";
import { microcourseH5Bytes, normalizeMicrocourseH5 } from "@/features/teacher-microcourses/h5";

const sha = "a".repeat(64);

function overlayDoc() {
  return {
    docVersion: "page-doc-v1" as const,
    sourceCoursewareId: "teacher-microcourse",
    sourcePageId: null,
    sourcePageDatabaseId: 1,
    sourceSnapshotId: 1,
    sourceContentHash: sha,
    canvas: {
      width: 960,
      height: 720,
      backgroundColor: null,
      backgroundBindingKey: null,
    },
    nodes: [],
    interactions: [],
  };
}

function sudokuPage(puzzle: SudokuGrid) {
  return {
    docVersion: MICROCOURSE_PAGE_DOC_VERSION,
    mode: "sudoku" as const,
    canvas: { width: 960 as const, height: 720 as const, backgroundColor: "#fff" },
    puzzle,
    display: {
      showCoordinates: true,
      allowCandidates: true,
      allowAnswerReveal: false,
      showTeachingTools: true,
    },
    analysis: analyzeSudokuPuzzle(puzzle),
  };
}

const UNIQUE_PUZZLE = (
  "530070000"
  + "600195000"
  + "098000060"
  + "800060003"
  + "400803001"
  + "700020006"
  + "060000280"
  + "000419005"
  + "000080079"
).split("").map(Number);

function gamePage(variantId: "classic-4x4" | "classic-6x6" | "classic-9x9", puzzle: number[]) {
  return {
    docVersion: "game-page-v1" as const,
    canvas: { width: 960 as const, height: 720 as const, backgroundColor: "#fff" },
    gameId: "sudoku",
    contentVersion: "sudoku-authored-v1",
    payload: {
      kind: "authored" as const,
      variantId,
      puzzle,
      display: {
        showCoordinates: true,
        allowCandidates: true,
        allowAnswerReveal: false,
        showTeachingTools: true,
      },
    },
    validation: {
      payloadHash: sha,
      validatorVersion: "sudoku-authored-v1@1",
      publishable: true,
      code: "unique",
      details: { status: "unique", solutionCount: 1 },
    },
  };
}

describe("teacher microcourse page documents", () => {
  it("parses a blank composition while keeping the teacher overlay 4:3", () => {
    const page = {
      docVersion: MICROCOURSE_PAGE_DOC_VERSION,
      mode: "composition",
      canvas: { width: 960, height: 720, backgroundColor: "#fff" },
      source: null,
      overlay: overlayDoc(),
    };

    expect(microcoursePageDocSchema.parse(page)).toEqual(page);
    expect(parseCoursewareDoc(page)).toEqual(page);
    expect(microcoursePageDocSchema.safeParse({
      ...page,
      overlay: { ...page.overlay, canvas: { ...page.overlay.canvas, width: 1_280 } },
    }).success).toBe(false);
  });

  it("allows incomplete Sudoku drafts but distinguishes every submission state", () => {
    const unique = analyzeSudokuPuzzle(UNIQUE_PUZZLE);
    expect(unique.status).toBe("unique");
    expect(unique.solutionCount).toBe(1);
    expect(unique.solution?.every((digit) => digit >= 1 && digit <= 9)).toBe(true);
    expect(microcoursePageDocSchema.safeParse(sudokuPage(UNIQUE_PUZZLE)).success).toBe(true);

    const conflict = [...UNIQUE_PUZZLE];
    conflict[2] = 5;
    expect(analyzeSudokuPuzzle(conflict)).toEqual({
      status: "conflict",
      solutionCount: 0,
      solution: null,
    });

    expect(analyzeSudokuPuzzle(new Array(81).fill(0))).toEqual({
      status: "multiple",
      solutionCount: 2,
      solution: null,
    });

    let unsolvable: SudokuGrid | null = null;
    if (unique.solution) {
      for (let index = 0; index < 81 && !unsolvable; index += 1) {
        if (UNIQUE_PUZZLE[index] !== 0) continue;
        for (let digit = 1; digit <= 9; digit += 1) {
          if (digit === unique.solution[index]) continue;
          const candidate = [...UNIQUE_PUZZLE];
          candidate[index] = digit;
          if (
            isValidPartialSudokuGrid(candidate)
            && analyzeSudokuPuzzle(candidate).status === "unsolvable"
          ) {
            unsolvable = candidate;
            break;
          }
        }
      }
    }
    expect(unsolvable).not.toBeNull();
    expect(analyzeSudokuPuzzle(unsolvable ?? [])).toEqual({
      status: "unsolvable",
      solutionCount: 0,
      solution: null,
    });
  });

  it("parses registered 4×4, 6×6 and 9×9 game pages through the shared document union", () => {
    for (const [variantId, size] of [
      ["classic-4x4", 4],
      ["classic-6x6", 6],
      ["classic-9x9", 9],
    ] as const) {
      const page = gamePage(variantId, new Array(size * size).fill(0));
      expect(gamePageDocSchema.parse(page)).toEqual(page);
      expect(parseCoursewareDoc(page)).toEqual(page);
    }
  });

  it("allows a published game revision as an immutable composition source", () => {
    const source = gamePage("classic-6x6", new Array(36).fill(0));
    const page = {
      docVersion: MICROCOURSE_PAGE_DOC_VERSION,
      mode: "composition",
      canvas: { width: 960, height: 720, backgroundColor: "#fff" },
      source: {
        sourceFamilyId: "00000000-0000-4000-8000-000000000001",
        sourceCourseId: "00000000-0000-4000-8000-000000000002",
        sourceLectureId: "00000000-0000-4000-8000-000000000003",
        sourceReleaseId: "00000000-0000-4000-8000-000000000004",
        sourcePageDocId: "00000000-0000-4000-8000-000000000005",
        sourceRevisionId: "00000000-0000-4000-8000-000000000006",
        sourcePageNo: 1,
        sourceTitle: "Six by six",
        doc: source,
      },
      overlay: overlayDoc(),
    };
    expect(microcoursePageDocSchema.parse(page)).toEqual(page);
  });

  it("limits single-file H5 documents to five MiB and pins their digest", () => {
    const page = {
      docVersion: MICROCOURSE_PAGE_DOC_VERSION,
      mode: "h5",
      canvas: { width: 960, height: 720, backgroundColor: "#fff" },
      artifactId: "00000000-0000-4000-8000-000000000001",
      sha256: sha,
      byteCount: MICROCOURSE_H5_MAX_BYTES,
      entryPath: "index.html",
    };
    expect(microcoursePageDocSchema.safeParse(page).success).toBe(true);
    expect(microcoursePageDocSchema.safeParse({
      ...page,
      byteCount: MICROCOURSE_H5_MAX_BYTES + 1,
    }).success).toBe(false);
    expect(normalizeMicrocourseH5("<p>a</p>\r\n<p>b</p>\r")).toBe("<p>a</p>\n<p>b</p>\n");
    expect(Array.from(microcourseH5Bytes("a\r\nb"))).toEqual(Array.from(new TextEncoder().encode("a\nb")));
  });

  it("uses an opaque, script-only iframe and denies every H5 network exit", () => {
    const stage = readFileSync(
      new URL("../src/features/courseware-doc/MicrocourseStage.tsx", import.meta.url),
      "utf8",
    );
    expect(stage).toContain('sandbox="allow-scripts"');
    expect(stage).not.toMatch(/allow-same-origin|allow-forms|allow-top-navigation/);
    expect(MICROCOURSE_H5_CSP).toContain("connect-src 'none'");
    expect(MICROCOURSE_H5_CSP).toContain("form-action 'none'");
    expect(MICROCOURSE_H5_CSP).toContain("frame-src 'none'");
    expect(microcourseH5SecurityHeaders()["Content-Security-Policy"]).toBe(MICROCOURSE_H5_CSP);
  });

  it("dispatches the new format without making the curriculum editor accept it", () => {
    const preview = readFileSync(
      new URL("../src/features/courseware-studio/StagePreview.tsx", import.meta.url),
      "utf8",
    );
    const studioPage = readFileSync(
      new URL("../src/app/[locale]/studio/courseware/[lectureId]/page.tsx", import.meta.url),
      "utf8",
    );
    expect(preview).toContain("isGamePageDoc(props.doc)");
    expect(preview).toContain("GamePageStage");
    expect(preview).toContain("isMicrocoursePageDoc(props.doc)");
    expect(preview).toContain("MicrocourseStage");
    expect(studioPage).toContain("isGamePageDoc(editor.activeRevision.doc)");
    expect(studioPage).toContain("isMicrocoursePageDoc(editor.activeRevision.doc)");
  });

  it("passes the saved Sudoku display contract into preparation and classroom rendering", () => {
    const stage = readFileSync(
      new URL("../src/features/courseware-doc/MicrocourseStage.tsx", import.meta.url),
      "utf8",
    );
    expect(stage).toContain("showCoordinates={doc.display.showCoordinates}");
    expect(stage).toContain("allowCandidates={doc.display.allowCandidates}");
    expect(stage).toContain("allowAnswerReveal={doc.display.allowAnswerReveal}");
    expect(stage).toContain("showTeachingTools={doc.display.showTeachingTools}");
  });
});
