"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  LearningCheckMatrixEntry,
  type LearningCheckMatrixCell,
  type LearningCheckMatrixItem,
  type LearningCheckMatrixOrientation,
} from "./LearningCheckMatrixEntry";
import type { LearningCheckStatus } from "./session-learning-contract";

interface PreviewStudent {
  index: number;
}

interface PreviewQuestion {
  index: number;
}

interface FillSnapshot {
  entries: Array<{ key: string; status: LearningCheckStatus }>;
}

const STUDENT_COUNT = 20;
const QUESTION_COUNT = 19;

const previewCellKey = (studentId: string, questionId: string) => `${studentId}:${questionId}`;

const INITIAL_STATUSES: Record<string, LearningCheckStatus> = {
  "preview-student-01:preview-question-01": "explained",
  "preview-student-02:preview-question-01": "independent",
  "preview-student-03:preview-question-01": "prompted",
  "preview-student-04:preview-question-01": "imitated",
  "preview-student-05:preview-question-01": "incomplete",
  "preview-student-01:preview-question-02": "independent",
  "preview-student-01:preview-question-03": "prompted",
};

/**
 * Local-only acceptance consumer for the shared students x questions matrix.
 * It intentionally owns no renderer: all orientation, quick-entry, keyboard,
 * mobile and bulk-fill behavior comes from LearningCheckMatrixEntry.
 */
export function LearningCheckMatrixPreview() {
  const t = useTranslations("school.session");
  const [orientation, setOrientation] = useState<LearningCheckMatrixOrientation>("by-question");
  const [activeStudentId, setActiveStudentId] = useState("preview-student-01");
  const [activeQuestionId, setActiveQuestionId] = useState("preview-question-01");
  const [statuses, setStatuses] = useState<Record<string, LearningCheckStatus>>(INITIAL_STATUSES);
  const [fillSnapshot, setFillSnapshot] = useState<FillSnapshot | null>(null);

  const students = useMemo<Array<LearningCheckMatrixItem<PreviewStudent>>>(() => (
    Array.from({ length: STUDENT_COUNT }, (_, index) => ({
      id: `preview-student-${String(index + 1).padStart(2, "0")}`,
      label: t("learningMatrixPreviewStudent", { index: index + 1 }),
      slot: index,
      data: { index: index + 1 },
    }))
  ), [t]);

  const questions = useMemo<Array<LearningCheckMatrixItem<PreviewQuestion>>>(() => (
    Array.from({ length: QUESTION_COUNT }, (_, index) => ({
      id: `preview-question-${String(index + 1).padStart(2, "0")}`,
      label: t("learningMatrixPreviewQuestion", { index: index + 1 }),
      slot: index,
      data: { index: index + 1 },
    }))
  ), [t]);

  const updateCell = (
    cell: LearningCheckMatrixCell<PreviewStudent, PreviewQuestion>,
    status: LearningCheckStatus,
  ) => {
    const key = previewCellKey(cell.student.id, cell.question.id);
    setFillSnapshot(null);
    setStatuses((current) => ({ ...current, [key]: status }));
  };

  const fillCells = (
    cells: Array<LearningCheckMatrixCell<PreviewStudent, PreviewQuestion>>,
    status: Exclude<LearningCheckStatus, "unchecked">,
  ) => {
    if (cells.length === 0) return;
    setFillSnapshot({
      entries: cells.map((cell) => {
        const key = previewCellKey(cell.student.id, cell.question.id);
        return { key, status: statuses[key] ?? "unchecked" };
      }),
    });
    setStatuses((current) => {
      const next = { ...current };
      for (const cell of cells) next[previewCellKey(cell.student.id, cell.question.id)] = status;
      return next;
    });
  };

  const undoFill = () => {
    if (!fillSnapshot) return;
    setStatuses((current) => {
      const next = { ...current };
      for (const entry of fillSnapshot.entries) next[entry.key] = entry.status;
      return next;
    });
    setFillSnapshot(null);
  };

  return (
    <section
      className="flex h-[calc(100dvh-12rem)] min-h-[36rem] min-w-0 flex-col overflow-hidden"
      data-learning-matrix-preview
    >
      <LearningCheckMatrixEntry
        students={students}
        questions={questions}
        orientation={orientation}
        onOrientationChange={setOrientation}
        activeStudentId={activeStudentId}
        activeQuestionId={activeQuestionId}
        onActiveStudentChange={setActiveStudentId}
        onActiveQuestionChange={setActiveQuestionId}
        statusFor={(studentId, questionId) => statuses[previewCellKey(studentId, questionId)] ?? "unchecked"}
        onStatusChange={updateCell}
        fill={{
          pending: false,
          canUndo: fillSnapshot !== null,
          onFill: fillCells,
          onUndo: undoFill,
        }}
      />
    </section>
  );
}
