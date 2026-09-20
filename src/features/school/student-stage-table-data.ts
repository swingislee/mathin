import "server-only";
import { loadStudentListQueryPage } from "./student-list-query-data";

import type { DashboardDateContext } from "./dashboard-page/dashboard-table-date-contract";
import type { StudentStageFilters } from "./student-stage-contract";

/** 各类学生名单复用同一字段合同，数据库完成筛选和分页。 */
export async function loadStudentStageFieldPage(filters: StudentStageFilters, context: DashboardDateContext, currentUserId: string,
  options: { includeRecordHints?: boolean; includeFieldFacets?: boolean } = {}) {
  return loadStudentListQueryPage(filters, context, currentUserId, options);
}
