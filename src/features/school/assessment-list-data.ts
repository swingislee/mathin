import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assessmentPageFilters, type AssessmentPageQuery, type AssessmentWorkbenchPage } from "./assessment-workbench-page";
import type { AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { parseFollowupFieldQuery } from "./followup-table-page";
import { studentListFacets, studentListFieldLabels, studentListRpcQuery } from "./student-list-query-contract";
import { dashboardFieldMessages } from "./dashboard-page/dashboard-field-messages";
import type { DashboardFieldDefinitions } from "./dashboard-page/dashboard-table-field-contract";
import type { DashboardDateContext } from "./dashboard-page/dashboard-table-date-contract";

const pageSchema = z.object({
  rows: z.array(z.object({ id: z.string(), name: z.string(), listSummary: z.literal(true) }).passthrough()),
  count: z.number().int().nonnegative(), page: z.number().int().positive(), totalPages: z.number().int().positive(),
  pageSize: z.union([z.literal(20), z.literal(50), z.literal(100)]),
  facets: z.record(z.string(), z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })), days: z.array(z.string()) })),
});

/** 数据库内完成全范围筛选、计数及排序；一次请求只返回当前页与筛选候选。 */
export async function loadAssessmentWorkbenchPage(fields: DashboardFieldDefinitions<AssessmentWorkbenchRow>, raw: AssessmentPageQuery,
  context: DashboardDateContext): Promise<AssessmentWorkbenchPage> {
  const filters = assessmentPageFilters(raw);
  const query = parseFollowupFieldQuery(fields, filters.fields);
  const labels = { ...studentListFieldLabels(fields),
    grade: Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
      const value = String(i + 1);
      return [value, fields.grade.kind === "enum" ? fields.grade.values({ grade: i + 1 } as AssessmentWorkbenchRow)[0]?.label ?? value : value];
    })), unknownPaper: dashboardFieldMessages(context.locale).unknownPaper };
  const client = await createClient();
  // 新 RPC 的边界在此集中声明；不将未生成的数据库类型扩散到页面。
  const rpc = (client.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>).bind(client);
  const response = await rpc("list_assessment_workbench_page", {
    p_state: filters.state, p_search: filters.q.trim(), p_page: filters.page, p_page_size: filters.pageSize,
    p_query: studentListRpcQuery(query), p_locale: context.locale.startsWith("en") ? "en" : "zh", p_labels: labels,
  });
  if (response.error) throw new Error(response.error.message);
  const { facets, rows, ...page } = pageSchema.parse(response.data);
  return { ...page, rows: rows as unknown as AssessmentWorkbenchRow[], q: filters.q, state: filters.state,
    fieldView: { query, facets: studentListFacets(facets, fields, context.locale) } };
}
