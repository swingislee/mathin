import {
  analyzeSudokuPuzzle,
  forcedSudokuCellValue,
  type SudokuPuzzleAnalysis,
} from "./logic";
import type {
  SudokuActivityPayload,
  SudokuAuthoredPayload,
  SudokuCoursewarePayload,
} from "./courseware-contract";

export interface SudokuTeachingTargetAnalysis {
  kind: "cell-value";
  index: number;
  value: number;
  forcedValue: number | null;
  status: "forced" | "not-forced";
}

export interface SudokuCoursewareActivityAnalysis {
  puzzle: SudokuPuzzleAnalysis;
  goalKind: "legacy-full-solution" | SudokuActivityPayload["goal"]["kind"];
  targets: SudokuTeachingTargetAnalysis[];
  ready: boolean;
  code: string;
  answerValues: number[];
  completionTargets: number[];
}

function sparseValues(length: number): number[] {
  return Array.from({ length }, () => 0);
}

function analyzeLegacy(payload: SudokuAuthoredPayload): SudokuCoursewareActivityAnalysis {
  const puzzle = analyzeSudokuPuzzle(payload.puzzle, payload.variantId);
  const ready = puzzle.status === "unique";
  return {
    puzzle,
    goalKind: "legacy-full-solution",
    targets: [],
    ready,
    code: puzzle.status,
    answerValues: puzzle.solution ? [...puzzle.solution] : sparseValues(payload.puzzle.length),
    completionTargets: sparseValues(payload.puzzle.length),
  };
}

function analyzeActivity(payload: SudokuActivityPayload): SudokuCoursewareActivityAnalysis {
  const puzzle = analyzeSudokuPuzzle(payload.puzzle, payload.variantId);
  const answers = sparseValues(payload.puzzle.length);
  const completionTargets = sparseValues(payload.puzzle.length);

  if (payload.goal.kind === "full-solution") {
    const ready = puzzle.status === "unique";
    return {
      puzzle,
      goalKind: payload.goal.kind,
      targets: [],
      ready,
      code: ready ? "full-solution-ready" : `full-solution-${puzzle.status}`,
      answerValues: puzzle.solution ? [...puzzle.solution] : answers,
      completionTargets,
    };
  }

  if (payload.goal.kind === "teacher-led") {
    const ready = puzzle.status === "unique" || puzzle.status === "multiple";
    return {
      puzzle,
      goalKind: payload.goal.kind,
      targets: [],
      ready,
      code: ready ? "teacher-led-ready" : `teacher-led-${puzzle.status}`,
      answerValues: answers,
      completionTargets,
    };
  }

  const targets = payload.goal.targets.map((target): SudokuTeachingTargetAnalysis => {
    const forcedValue = puzzle.status === "unique" || puzzle.status === "multiple"
      ? forcedSudokuCellValue(payload.puzzle, target.index, payload.variantId)
      : null;
    const forced = forcedValue === target.value;
    if (forced) {
      answers[target.index] = target.value;
      completionTargets[target.index] = target.value;
    }
    return {
      ...target,
      forcedValue,
      status: forced ? "forced" : "not-forced",
    };
  });
  const puzzleSolvable = puzzle.status === "unique" || puzzle.status === "multiple";
  const ready = puzzleSolvable
    && targets.length > 0
    && targets.every((target) => target.status === "forced");
  return {
    puzzle,
    goalKind: payload.goal.kind,
    targets,
    ready,
    code: ready
      ? "teaching-target-ready"
      : !puzzleSolvable
        ? `teaching-target-${puzzle.status}`
        : targets.length === 0
          ? "teaching-target-required"
          : "teaching-target-not-forced",
    answerValues: answers,
    completionTargets,
  };
}

export function analyzeSudokuCoursewareActivity(
  payload: SudokuCoursewarePayload,
): SudokuCoursewareActivityAnalysis {
  return payload.kind === "authored" ? analyzeLegacy(payload) : analyzeActivity(payload);
}

