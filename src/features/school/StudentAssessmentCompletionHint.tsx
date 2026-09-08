import { SourceMissingDetailsBadge } from "./SourceMissingDetailsBadge";
import { sourceCompletionSummary } from "./source-completion-contract";
import type { StudentStageRow } from "./student-stage-contract";

export function StudentAssessmentCompletionHint({ row, locale }: { row: StudentStageRow; locale: string }) {
  if (row.assessmentSource !== "assessment") return null;
  const summary = sourceCompletionSummary([], true, [{
    status: "attended", hasResult: true, date: row.assessmentAt, score: row.score,
    band: row.assessmentBand, teacher: row.teacherName || row.teacherId || null,
  }]);
  return <SourceMissingDetailsBadge missing={summary?.missing ?? []} locale={locale} />;
}
