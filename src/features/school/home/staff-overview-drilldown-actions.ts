"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveEnvironment } from "@/lib/auth";
import { getStaffOverviewData } from "./staff-overview-data";
import type { OverviewDetailResult } from "./staff-overview-drilldown-contract";

const inputSchema = z.object({
  grain: z.enum(["week", "month"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string().datetime(),
  selectedSupportIds: z.array(z.string().max(120)).max(1000),
  query: z.object({
    kind: z.enum(["business", "support", "participation", "capacity", "pending"]),
    metric: z.string().max(60).optional(), scope: z.string().max(120).optional(),
    group: z.enum(["teacher", "grade", "class"]).optional(), period: z.enum(["current", "previous"]).optional(),
  }),
  search: z.string().max(120).default(""), page: z.number().int().min(0).max(200).default(0),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(50),
});

export async function readOverviewDetail(input: unknown): Promise<OverviewDetailResult> {
  const args = inputSchema.parse(input);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || await getActiveEnvironment(user.id) !== "staff") throw new Error("Overview access required");
  const data = await getStaffOverviewData({ grain: args.grain, date: args.date, now: new Date(args.generatedAt),
    detail: args.query, selectedSupportIds: args.selectedSupportIds });
  const records = data.detail?.records ?? [];
  const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((id): id is string => Boolean(id)))];
  // 所有补充名称仍由当前登录身份读取，分批查询避免 URL 长度限制。
  const leadNames = new Map<string, { name: string; studentId: string | null }>();
  const studentNames = new Map<string, string>();
  const sourceNames = new Map<string, string>();
  const leadIds = unique(records.map(row => row.leadId));
  for (let offset = 0; offset < leadIds.length; offset += 150) {
    const result = await supabase.from("leads").select("id,provisional_student_name,student_id").in("id", leadIds.slice(offset, offset + 150));
    if (result.error) throw new Error("Detail names unavailable");
    result.data.forEach(row => leadNames.set(row.id, { name: row.provisional_student_name, studentId: row.student_id }));
  }
  const studentIds = unique(records.map(row => row.studentId ?? (row.leadId ? leadNames.get(row.leadId)?.studentId : null)));
  for (let offset = 0; offset < studentIds.length; offset += 150) {
    const result = await supabase.from("students").select("id,name").in("id", studentIds.slice(offset, offset + 150));
    if (result.error) throw new Error("Detail names unavailable");
    result.data.forEach(row => studentNames.set(row.id, row.name));
  }
  const sourceIds = unique(records.filter(row => !row.name && !row.studentId && !row.leadId).map(row => row.sourceId));
  for (let offset = 0; offset < sourceIds.length; offset += 150) {
    const result = await supabase.from("history_import_records").select("id,record_data").in("id", sourceIds.slice(offset, offset + 150));
    if (result.error) throw new Error("Source names unavailable");
    result.data.forEach(row => {
      const record = row.record_data as { cells?: Array<{ fieldName: string; text: string }> };
      const name = record?.cells?.find(cell => /^(学员姓名|学生姓名|姓名)$/.test(cell.fieldName))?.text;
      if (name) sourceNames.set(row.id, name);
    });
  }
  const enriched = records.map(row => {
    const lead = row.leadId ? leadNames.get(row.leadId) : undefined;
    const studentId = row.studentId ?? lead?.studentId;
    return { ...row, studentId, name: (studentId ? studentNames.get(studentId) : undefined) || lead?.name || row.name || (row.sourceId ? sourceNames.get(row.sourceId) : undefined),
      href: row.href ?? (studentId && studentNames.has(studentId) ? `/dashboard/students/${studentId}` : undefined) };
  }).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "") || (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id));
  const search = args.search.trim().toLocaleLowerCase();
  const filtered = search ? enriched.filter(row => [row.name, row.person, ...(row.values ?? []).map(item => item.value)].some(value => value?.toLocaleLowerCase().includes(search))) : enriched;
  const page = Math.min(args.page, Math.max(0, Math.ceil(filtered.length / args.pageSize) - 1));
  const previous = args.query.period === "previous";
  return { available: data.detail?.available ?? false, records: filtered.slice(page * args.pageSize, (page + 1) * args.pageSize), total: records.length,
    filteredTotal: filtered.length, page, pageSize: args.pageSize, timeZone: data.timeZone,
    range: args.query.kind === "capacity" || args.query.kind === "pending" ? data.generatedAt
      : `${previous ? data.previousStart : data.currentStart}/${previous ? data.previousCutoff : data.currentCutoff}` };
}
