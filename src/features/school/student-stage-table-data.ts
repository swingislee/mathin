import "server-only";

import { loadStudentRecordSummaries } from "./student-stage-data";
import { followupFieldPage, parseFollowupFieldQuery } from "./followup-table-page";
import { studentStageFieldScope, studentStageTableFields } from "./student-stage-table-fields";
import type { DashboardDateContext } from "./dashboard-page/dashboard-table-date-contract";
import type { StudentStageFilters } from "./student-stage-contract";

/** 复用已有权限读取及跟进字段合同；服务端筛选整个阶段，浏览器只接收最后一页。 */
export async function loadStudentStageFieldPage(filters: StudentStageFilters, context: DashboardDateContext, currentUserId: string) {
  const fields = studentStageTableFields(context.locale, filters.stage, currentUserId);
  const query = parseFollowupFieldQuery(fields, filters.fields ?? { version: 2, filters: {
    ...(filters.scope !== "all" ? { scope: { kind: "enum", values: [filters.scope] } } : {}),
    ...(filters.detail ? { detail: { kind: "enum", values: [filters.detail] } } : {}),
  }, sort: null });
  const scope = studentStageFieldScope(query);
  const source = await loadStudentRecordSummaries({ ...filters, scope, detail: "" });
  const result = followupFieldPage([...new Map(source.rows.map(row => [row.key, row])).values()], fields, query, context, filters.page, filters.pageSize);
  // 范围可由菜单直接切换；候选不受本次 mine/unassigned 读取范围限制。
  result.fieldView.facets.scope = { options: fields.scope.kind === "enum" ? [...fields.scope.options ?? []] : [], days: [] };
  return { ...result, counts: source.counts };
}
