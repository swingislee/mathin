import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getOrganizationTimezoneV2 } from "../organization-locations";
import { resolveSourceStaffId } from "../business-source-contract";
import { buildOverviewAcquisitions, type OverviewAcquisitionLead, type OverviewLeadSubmission } from "./staff-overview-acquisition-contract";
import { readOverviewAcquisitions } from "./staff-overview-acquisition-read";
import { buildStaffOverviewWindow, type StaffOverviewGrain } from "./staff-overview-contract";
import { selectOverviewDetailEvents, type OverviewDetailQuery, type OverviewDetailRecord } from "./staff-overview-drilldown-contract";
import { readOverviewRows, STAFF_OVERVIEW_READ_LIMIT } from "./staff-overview-read";

type Lead = OverviewAcquisitionLead & { student_id: string | null };
type SourceLink = { source_record_id: string | null; lead_id: string | null };
type Profile = { id: string; display_name: string; role: string; is_active: boolean };

/** 获客明细复用总览的来源事件与范围合同；关联事实只读取归属所需的两个键。 */
export async function getStaffOverviewAcquisitionDetail({ grain, date, now, detail, selectedSupportIds }: {
  grain: StaffOverviewGrain; date: string; now: Date; detail: OverviewDetailQuery; selectedSupportIds: string[];
}) {
  const [supabase, timeZone] = await Promise.all([createClient(), getOrganizationTimezoneV2()]);
  const window = buildStaffOverviewWindow(grain, now, timeZone, date);
  if (grain === "month") window.previousCutoff = window.previousEnd;
  const [sourcesResult, leadsResult, submissionsResult, profilesResult, ...linkResults] = await Promise.all([
    readOverviewAcquisitions(supabase),
    readOverviewRows<Lead>(() => supabase.from("leads").select("id,owner_id,student_id,created_at,source_record_id")),
    readOverviewRows<OverviewLeadSubmission>(() => supabase.from("lead_source_records").select("id,lead_id,submitted_at")),
    readOverviewRows<Profile>(() => supabase.from("profiles").select("id,display_name,role,is_active").in("role", ["staff", "admin"]).eq("is_active", true)),
    readOverviewRows<SourceLink>(() => supabase.from("business_lead_communications" as "lead_communications").select("source_record_id,lead_id")),
    readOverviewRows<SourceLink>(() => supabase.from("business_activity_registrations" as "activity_registrations").select("source_record_id,lead_id")),
    readOverviewRows<SourceLink>(() => supabase.from("business_assessment_results" as "assessment_results").select("source_record_id,lead_id")),
  ]);
  const sources = sourcesResult.data ?? [], leads = leadsResult.data ?? [], profiles = profilesResult.data ?? [];
  const complete = [sourcesResult, leadsResult, submissionsResult, profilesResult, ...linkResults]
    .every(result => !result.error && (result.data?.length ?? 0) < STAFF_OVERVIEW_READ_LIMIT);
  const available = complete && !(sources.length === 0 && leads.some(row => row.source_record_id));
  const sourceNames = new Map<string, string>();
  const profileNames = new Map(profiles.map(profile => [profile.id, profile.display_name]));
  const events = buildOverviewAcquisitions({ sources, leads, submissions: submissionsResult.data ?? [],
    sourceLinks: linkResults.flatMap(result => result.data ?? []),
  }, timeZone).filter((event): event is typeof event & { at: string } => event.at !== null).map(event => {
    if (!event.sourcePerson) return event;
    const account = resolveSourceStaffId(event.sourcePerson, profiles);
    const personId = account ?? `source-staff:${encodeURIComponent(event.sourcePerson)}`;
    if (!account) sourceNames.set(personId, event.sourcePerson);
    return { ...event, personId };
  });
  const leadById = new Map(leads.map(lead => [lead.id, lead]));
  const leadBySource = new Map<string, Lead>();
  for (const lead of leads) if (lead.source_record_id && !leadBySource.has(lead.source_record_id)) leadBySource.set(lead.source_record_id, lead);
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const records: OverviewDetailRecord[] = selectOverviewDetailEvents(events, window, detail, selectedSupportIds).map((event, index) => {
    const source = sourceById.get(event.id);
    const lead = leadById.get(event.id.replace(/^submission:/, "")) ?? (source?.lead_id ? leadById.get(source.lead_id) : undefined)
      ?? leadBySource.get(event.id) ?? source?.source_alias_ids?.map(id => leadBySource.get(id)).find(Boolean);
    return { id: `${event.id}:${index}`, at: event.at, sourceName: event.sourceName,
      leadId: lead?.id ?? source?.lead_id, studentId: lead?.student_id, sourceId: source?.id,
      name: source?.record_data.cells?.find(cell => cell.fieldName === "学员姓名")?.text,
      person: event.personId ? profileNames.get(event.personId) || sourceNames.get(event.personId) || event.personId.slice(0, 8) : undefined };
  });
  return { detail: { available, records: available ? records : [] }, timeZone, generatedAt: now.toISOString(),
    currentStart: window.currentStart.toISOString(), currentCutoff: window.currentCutoff.toISOString(),
    previousStart: window.previousStart.toISOString(), previousCutoff: window.previousCutoff.toISOString() };
}
