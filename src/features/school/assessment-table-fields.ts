import { ASSESSMENT_BANDS } from "./activity-workflow-contract";
import { assessmentWorkbenchHasFinalResult, ASSESSMENT_WORKBENCH_QUEUES, type AssessmentWorkbenchQueue, type AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { dashboardFieldMessages } from "./dashboard-page/dashboard-field-messages";
import { dashboardDay } from "./dashboard-page/dashboard-table-date-contract";
import { EMPTY_DASHBOARD_FIELD_QUERY, type DashboardFieldDefinitions, type DashboardFieldOption, type DashboardFieldQuery } from "./dashboard-page/dashboard-table-field-contract";

export const ASSESSMENT_TABLE_COLUMNS = {
  student: ["name", "phone", "grade"],
  kind: ["status", "kind"],
  arrangement: ["scheduledAt", "supportOwner", "location"],
  result: ["paper", "score", "scoreRate", "band", "progress", "resultSource"],
  teacher: ["conclusion"],
  status: ["assessor", "assessorSource"],
  updated: ["recordedAt"],
} as const;

export function assessmentTableBand(row: AssessmentWorkbenchRow) {
  const value = row.assessment?.assessmentBand;
  return value && (ASSESSMENT_BANDS as readonly string[]).includes(value) ? value : null;
}

/** 有来源依据的满分与正式结果一起解释；关联了试卷不等于按该试卷评分。 */
export function assessmentTableScore(row: AssessmentWorkbenchRow) {
  const result = row.assessment;
  const score = assessmentWorkbenchHasFinalResult(row) && typeof result?.score === "number" && Number.isFinite(result.score) ? result.score : null;
  const candidate = result?.scoreMax ?? (result?.resultSource === "teacher" ? row.questionSummary?.totalScore : null);
  const max = typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0 ? candidate : null;
  const invalid = score !== null && (score < 0 || candidate != null && (max === null || score > max));
  const rate = score !== null && max !== null && !invalid ? score * 100 / max : null;
  const paperVersionId = row.paperVersionId ?? row.questionSummary?.paperVersionId ?? null;
  return { score, max, invalid, rate, paperVersionId,
    comparableScore: paperVersionId && result?.resultSource === "teacher" && rate !== null ? score : null };
}

export function formatAssessmentTableScore(row: AssessmentWorkbenchRow, locale: string) {
  const value = assessmentTableScore(row), m = dashboardFieldMessages(locale);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return {
    label: value.score === null ? "—" : value.max !== null ? `${number.format(value.score)} / ${number.format(value.max)}` : `${number.format(value.score)} ${locale.startsWith("zh") ? "分" : "pts"}`,
    hint: value.score === null ? "" : value.invalid ? m.scoreInvalid : value.max === null ? m.scoreMaxMissing : "",
  };
}

export function assessmentScheduledDate(row: AssessmentWorkbenchRow, timeZone: string): string | null {
  return dashboardDay(row.scheduledAt, timeZone) ? row.scheduledAt : dashboardDay(row.occurredOn, timeZone) ? row.occurredOn! : null;
}

export function assessmentRecordDate(row: AssessmentWorkbenchRow): string | null {
  // 来源行的 updatedAt 可能是导入时间，只有实际发生日可以作为已知业务日期。
  return row.sourceRecordId || row.recordState === "historical" ? row.occurredOn ?? null : row.updatedAt;
}

export function assessmentTableConclusion(row: AssessmentWorkbenchRow): string {
  if (row.assessment?.resultSource === "quick_entry") return row.assessment.teacherRecommendation || row.assessment.strengths || "";
  if (row.assessment?.resultSource === "teacher") return row.assessment.teacherObservation;
  return row.assessment?.teacherObservation || row.assessment?.teacherRecommendation || row.assessment?.strengths || "";
}

type Translate = (key: string, values?: Record<string, string | number>) => string;
const option = (value: string | null | undefined, label = value): DashboardFieldOption[] => value ? [{ value, label: label || value }] : [];

export function assessmentTableFields({ locale, timeZone, tableT, assessmentT, t, teacherT, quickT, stageFor }: {
  locale: string; timeZone: string;
  tableT: Translate; assessmentT: Translate; t: Translate; teacherT: Translate; quickT: Translate;
  stageFor: (row: AssessmentWorkbenchRow) => Exclude<AssessmentWorkbenchQueue, "all">;
}): DashboardFieldDefinitions<AssessmentWorkbenchRow> {
  const m = dashboardFieldMessages(locale);
  const bandOptions = ASSESSMENT_BANDS.map(value => ({ value, label: teacherT(`band_${value}`) }));
  const queueKeys = { pending: "queue_assessment_pending", in_progress: "queue_in_progress", feedback: "queue_pending", handled: "queue_handled" };
  const stages = ASSESSMENT_WORKBENCH_QUEUES.filter(value => value !== "all").map(value => ({ value, label: t(queueKeys[value]) }));
  const sources = [{ value: "teacher", label: quickT("teacherResult") }, { value: "quick_entry", label: quickT("quickResult") }, { value: "legacy", label: m.recordedResult }];
  return {
    name: { kind: "text", label: tableT("fieldName"), value: row => row.name },
    phone: { kind: "text", label: tableT("fieldPhone"), value: row => row.phone },
    grade: { kind: "enum", label: tableT("fieldGrade"), values: row => row.grade ? option(String(row.grade), assessmentT("gradeValue", { grade: row.grade })) : [], sortValue: row => row.grade },
    kind: { kind: "enum", label: tableT("fieldType"), values: row => option(row.assessmentKind, t(`type_${row.assessmentKind}`)),
      options: ["one_to_one", "activity"].map(value => ({ value, label: t(`type_${value}`) })) },
    scheduledAt: { kind: "date", label: m.scheduledAt, value: row => assessmentScheduledDate(row, timeZone) },
    location: { kind: "enum", label: tableT("fieldLocation"), values: row => option(row.location.trim()), sortValue: row => row.location },
    assessor: { kind: "enum", label: tableT("fieldAssessor"), values: row => option(row.assessorId, row.assessorName), sortValue: row => row.assessorName },
    supportOwner: { kind: "enum", label: m.supportOwner, values: row => option(row.supportOwnerId || (row.supportOwnerName ? `source:${row.supportOwnerName}` : null), row.supportOwnerName),
      sortValue: row => row.supportOwnerName || null },
    assessorSource: { kind: "enum", label: tableT("fieldAssessorSource"), values: row => option(row.assessorSource, t(row.assessorSource === "actual" ? "actualAssessor" : "assignedAssessor")),
      options: ["assigned", "actual"].map(value => ({ value, label: t(value === "actual" ? "actualAssessor" : "assignedAssessor") })) },
    paper: { kind: "enum", label: m.paperVersion, multiple: false, values: row => {
      const id = assessmentTableScore(row).paperVersionId;
      return option(id, `${row.questionSummary?.paperTitle || m.unknownPaper}${id ? ` · ${id.slice(0, 8)}` : ""}`);
    }, sortValue: row => row.questionSummary?.paperTitle },
    score: { kind: "number", label: m.score, hint: m.scoreScope, value: row => assessmentTableScore(row).comparableScore, step: 1, requiresSingleValue: "paper" },
    scoreRate: { kind: "number", label: m.scoreRate, hint: m.rateHint, value: row => assessmentTableScore(row).rate, step: 0.1 },
    band: { kind: "enum", label: tableT("fieldBand"), options: bandOptions, values: row => {
      const band = assessmentTableBand(row);
      return option(band, band ? teacherT(`band_${band}`) : "");
    }, sortValue: row => { const band = assessmentTableBand(row); return band ? bandOptions.findIndex(option => option.value === band) : null; } },
    progress: { kind: "number", label: m.progress, hint: m.progressHint, step: 1,
      value: row => row.questionSummary && row.questionSummary.questionCount > 0 ? row.questionSummary.answeredCount * 100 / row.questionSummary.questionCount : null },
    resultSource: { kind: "enum", label: m.scoreSource, options: sources, values: row => row.assessment
      ? option(row.assessment.resultSource ?? "legacy", sources.find(option => option.value === (row.assessment?.resultSource ?? "legacy"))?.label) : [] },
    conclusion: { kind: "text", label: t("teacherColumn"), sortable: false, value: row => [assessmentTableConclusion(row), row.assessment?.strengths, row.assessment?.focusAreas, row.assessment?.parentConcerns].filter(Boolean).join("\n") },
    status: { kind: "enum", label: tableT("fieldStatus"), options: stages, multiple: false,
      values: row => row.recordState === "historical" ? [] : option(stageFor(row), t(queueKeys[stageFor(row)])),
      sortValue: row => row.recordState === "historical" ? null : ASSESSMENT_WORKBENCH_QUEUES.indexOf(stageFor(row)) },
    recordedAt: { kind: "date", label: m.recordedAt, hint: m.recordedHint, value: assessmentRecordDate },
  };
}

/** 只迁移能唯一对应的旧条件；文案日期、裸分、姓名枚举等旧值重新选择。 */
export function migrateAssessmentFieldQuery(value: unknown): DashboardFieldQuery {
  const result: DashboardFieldQuery = { ...EMPTY_DASHBOARD_FIELD_QUERY, filters: {} };
  if (!value || typeof value !== "object" || !("filters" in value) || !value.filters || typeof value.filters !== "object") return result;
  const filters = value.filters as Record<string, unknown>;
  if (typeof filters.status === "string" && ["pending", "in_progress", "feedback", "handled"].includes(filters.status)) result.filters.status = { kind: "enum", values: [filters.status] };
  if (typeof filters.kind === "string" && ["one_to_one", "activity"].includes(filters.kind)) result.filters.kind = { kind: "enum", values: [filters.kind] };
  if ("sort" in value && value.sort && typeof value.sort === "object" && "column" in value.sort && "direction" in value.sort) {
    const columns: Record<string, string> = { student: "name", kind: "kind", arrangement: "scheduledAt", status: "status", updated: "recordedAt" };
    if (typeof value.sort.column === "string" && Object.hasOwn(columns, value.sort.column) && (value.sort.direction === "asc" || value.sort.direction === "desc")) {
      result.sort = { field: columns[value.sort.column], direction: value.sort.direction };
    }
  }
  return result;
}
