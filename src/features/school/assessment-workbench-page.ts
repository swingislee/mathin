import { assessmentWorkbenchStage, type AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { businessRecordStateFilter, matchesBusinessRecordState } from "./business-record-state-contract";
import { followupFieldPage, followupPageSize, parseFollowupFieldQuery } from "./followup-table-page";
import type { DashboardDateContext } from "./dashboard-page/dashboard-table-date-contract";
import type { DashboardFieldDefinitions } from "./dashboard-page/dashboard-table-field-contract";

export type AssessmentPageQuery = Record<string, string | string[] | undefined>;

export function assessmentPageFilters(raw: AssessmentPageQuery) {
  const pick = (key: string) => Array.isArray(raw[key]) ? raw[key][0] : raw[key];
  const requestedPage = Number(pick("page"));
  return { q: (pick("q") ?? "").slice(0, 100), state: businessRecordStateFilter(pick("state")), fields: pick("fields"),
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1_000_000) : 1,
    pageSize: followupPageSize(pick("pageSize")) };
}

export function assessmentSearchRows(rows: readonly AssessmentWorkbenchRow[], q: string, state: ReturnType<typeof businessRecordStateFilter>, locale: string) {
  const needle = q.trim().toLocaleLowerCase(locale);
  return rows.filter(row => matchesBusinessRecordState(row.recordState, state) && (!needle || [
    row.name, row.phone, row.gradeText, row.location, row.assessorName, row.background, row.activityTitle,
    row.assessment?.teacherObservation ?? "", row.assessment?.teacherRecommendation ?? "", row.assessment?.strengths ?? "",
    row.assessment?.focusAreas ?? "", row.assessment?.parentConcerns ?? "", row.questionSummary?.paperTitle ?? "",
  ].some(value => value.toLocaleLowerCase(locale).includes(needle))));
}

// 无草稿时沿用工作表原有的归类口径。
export function assessmentPageStage(row: AssessmentWorkbenchRow) {
  const stage = assessmentWorkbenchStage(row);
  return row.workflow ? stage : row.route?.route || stage === "feedback" || stage === "handled" ? row.route?.route ? "handled" : "feedback" : stage;
}

export function assessmentWorkbenchFieldPage(rows: readonly AssessmentWorkbenchRow[], fields: DashboardFieldDefinitions<AssessmentWorkbenchRow>,
  raw: AssessmentPageQuery, context: DashboardDateContext) {
  const filters = assessmentPageFilters(raw);
  const query = parseFollowupFieldQuery(fields, filters.fields);
  // 读取器已经按业务日期和稳定行键排序；保持同一默认顺序，避免按本地语言重新排序。
  const effectiveQuery = query.sort?.field === "scheduledAt" && query.sort.direction === "desc" ? { ...query, sort: null } : query;
  const result = followupFieldPage(assessmentSearchRows(rows, filters.q, filters.state, context.locale), fields, effectiveQuery, context, filters.page, filters.pageSize);
  return { ...result, fieldView: { ...result.fieldView, query }, q: filters.q, state: filters.state };
}

export type AssessmentWorkbenchPage = ReturnType<typeof assessmentWorkbenchFieldPage>;
