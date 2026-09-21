import { overviewFactInstant } from "./staff-overview-source-contract";

export interface OverviewAcquisitionSource {
  id: string;
  lead_id: string | null;
  source_alias_ids?: string[];
  record_data: { cells?: Array<{ fieldName: string; text: string }> };
}

export const OVERVIEW_ACQUISITION_FIELDS = ["获取日期", "登记日期（此列不用填，自动生成）", "学员姓名", "家长电话", "确认人员", "跟进人", "沟通人员"] as const;

/** 每一行核对字段名称；来源列顺序变化的行交回完整读取，不根据位置猜测数据。 */
export function projectedOverviewAcquisition(row: { id: string; lead_id: string | null } & Record<string, unknown>): OverviewAcquisitionSource | null {
  const cells = OVERVIEW_ACQUISITION_FIELDS.map((fieldName, index) => ({ fieldName, text: row[`text${index}`] }));
  if (cells.some((cell, index) => row[`field${index}`] !== cell.fieldName || typeof cell.text !== "string")) return null;
  return { id: row.id, lead_id: row.lead_id, record_data: { cells: cells as Array<{ fieldName: string; text: string }> } };
}

export interface OverviewAcquisitionLead {
  id: string;
  created_at: string;
  source_record_id: string | null;
  owner_id: string | null;
}

export interface OverviewLeadSubmission {
  id: string;
  lead_id: string;
  submitted_at: string | null;
}

function cell(source: OverviewAcquisitionSource, field: string): string {
  return source.record_data.cells?.find(row => row.fieldName === field)?.text.trim() ?? "";
}

/** 月日仅在原始登记日期同月、且相隔至多七天时补来源年份；导入时刻不参与推断。 */
export function overviewAcquiredOn(raw: string, sourceRegisteredOn: string): string | null {
  const valid = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
  };
  const full = raw.trim().match(/^(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})(?:日)?(?:$|[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$)/u);
  if (full) return valid(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = raw.trim().match(/^(\d{1,2})[./月-](\d{1,2})日?$/u);
  const anchor = sourceRegisteredOn.trim().match(/^(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})(?:日)?$/u);
  if (!short || !anchor || Number(short[1]) !== Number(anchor[2])) return null;
  const date = valid(Number(anchor[1]), Number(short[1]), Number(short[2]));
  const registered = valid(Number(anchor[1]), Number(anchor[2]), Number(anchor[3]));
  if (!date || !registered) return null;
  const lag = (Date.parse(registered) - Date.parse(date)) / 86_400_000;
  return lag >= 0 && lag <= 7 ? date : null;
}

/** 主表按来源行计获客；已有明确关联的小地推记录只作补充，原生 Lead 使用创建时刻。 */
export function buildOverviewAcquisitions(input: {
  sources: readonly OverviewAcquisitionSource[];
  leads: readonly OverviewAcquisitionLead[];
  submissions: readonly OverviewLeadSubmission[];
  sourceLinks: readonly { source_record_id: string | null; lead_id: string | null }[];
}, timeZone: string) {
  const leadById = new Map(input.leads.map(row => [row.id, row]));
  const currentSourceIds = new Map(input.sources.flatMap(row => [row.id, ...row.source_alias_ids ?? []].map(id => [id, row.id] as const)));
  const sourceLeads = new Map<string, Set<string>>();
  const link = (sourceId: string | null, leadId: string | null) => {
    if (!sourceId || !leadId || !leadById.has(leadId)) return;
    sourceId = currentSourceIds.get(sourceId) ?? sourceId;
    const values = sourceLeads.get(sourceId) ?? new Set<string>();
    values.add(leadId);
    sourceLeads.set(sourceId, values);
  };
  input.leads.forEach(row => link(row.source_record_id, row.id));
  input.sources.forEach(row => link(row.id, row.lead_id));
  input.sourceLinks.forEach(row => link(row.source_record_id, row.lead_id));
  const primaryLeadIds = new Set(input.sources.flatMap(row => [...sourceLeads.get(row.id) ?? []]));
  const submittedLeadIds = new Set(input.submissions.map(row => row.lead_id));
  const events: Array<{ id: string; at: string | null; personId: string | null; sourcePerson?: string; sourceName?: string; sourceId?: string }> = [];
  for (const source of input.sources) {
    const rawDate = cell(source, "获取日期");
    if (!rawDate && !cell(source, "学员姓名") && !cell(source, "家长电话")) continue;
    const ids = [...sourceLeads.get(source.id) ?? []];
    events.push({
      id: source.id,
      at: overviewFactInstant(null, overviewAcquiredOn(rawDate, cell(source, "登记日期（此列不用填，自动生成）")), timeZone),
      personId: ids.length === 1 ? leadById.get(ids[0])?.owner_id ?? null : null,
      sourcePerson: cell(source, "确认人员") || cell(source, "跟进人") || cell(source, "沟通人员") || undefined,
      sourceName: cell(source, "学员姓名") || undefined, sourceId: source.id,
    });
  }
  const firstSubmission = new Map<string, OverviewLeadSubmission>();
  for (const row of input.submissions) {
    if (!leadById.has(row.lead_id) || primaryLeadIds.has(row.lead_id)) continue;
    const prior = firstSubmission.get(row.lead_id);
    if (!prior || row.submitted_at && (!prior.submitted_at || row.submitted_at < prior.submitted_at)) firstSubmission.set(row.lead_id, row);
  }
  for (const row of firstSubmission.values()) events.push({
    id: `submission:${row.lead_id}`, at: overviewFactInstant(row.submitted_at, null, timeZone),
    personId: leadById.get(row.lead_id)?.owner_id ?? null,
  });
  for (const lead of input.leads) {
    if (primaryLeadIds.has(lead.id) || submittedLeadIds.has(lead.id)) continue;
    events.push({ id: lead.id, at: lead.source_record_id ? null : overviewFactInstant(lead.created_at, null, timeZone), personId: lead.owner_id });
  }
  return events;
}
