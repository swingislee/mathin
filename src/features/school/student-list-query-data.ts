import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { studentStageRowSchema, studentStageRpc } from "./student-stage-data";
import { parseFollowupFieldQuery, type FollowupServerFields } from "./followup-table-page";
import { studentListFieldLabels, studentListFacets, studentListRpcQuery } from "./student-list-query-contract";
import { studentStageFieldScope, studentStageTableFields } from "./student-stage-table-fields";
import type { DashboardDateContext } from "./dashboard-page/dashboard-table-date-contract";
import type { StudentStageFilters, StudentStageData } from "./student-stage-contract";
import { readSchoolRecordHints } from "./school-record-review-data";

const pageSchema = z.object({
  rows: z.array(studentStageRowSchema), counts: z.record(z.string(), z.number().int().nonnegative()),
  count: z.number().int().nonnegative(), page: z.number().int().positive(), totalPages: z.number().int().positive(),
  pageSize: z.union([z.literal(20), z.literal(50), z.literal(100)]),
  facets: z.record(z.string(), z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })), days: z.array(z.string()) })),
});

/** 一次完成权限范围、事实汇总、列条件及分页，服务端只接收当前页。 */
export async function loadStudentListQueryPage(filters: StudentStageFilters, context: DashboardDateContext, currentUserId: string): Promise<StudentStageData & { fieldView: FollowupServerFields }> {
  const fields = studentStageTableFields(context.locale, filters.stage, currentUserId);
  const query = parseFollowupFieldQuery(fields, filters.fields ?? { version: 2, filters: {
    ...(filters.scope !== "all" ? { scope: { kind: "enum", values: [filters.scope] } } : {}),
    ...(filters.detail ? { detail: { kind: "enum", values: [filters.detail] } } : {}),
  }, sort: null });
  const client = await createClient();
  const { facets, ...page } = pageSchema.parse(await studentStageRpc(client, "list_student_records_page", {
    p_stage: filters.stage, p_scope: studentStageFieldScope(query), p_search: filters.q, p_population: filters.population ?? "work",
    p_page: filters.page, p_page_size: filters.pageSize, p_query: studentListRpcQuery(query),
    p_locale: context.locale.startsWith("en") ? "en" : "zh", p_labels: studentListFieldLabels(fields),
  }));
  const hints = await readSchoolRecordHints(client, page.rows.map(row => ({ studentId: row.studentId, leadId: row.leadId })));
  const rows = page.rows.map(row => ({ ...row, possibleDuplicateCount: hints.get(row.key) ?? 0 }));
  const fieldView = { query, facets: studentListFacets(facets, fields, context.locale) };
  // 范围菜单支持直接切换；筛选与实际读写权限分别由数据库验证。
  fieldView.facets.scope = { options: fields.scope.kind === "enum" ? [...fields.scope.options ?? []] : [], days: [] };
  return { ...page, rows, fieldView };
}
