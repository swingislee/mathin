import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  LEAD_STATUSES,
  parseLeadPageSize,
  type LeadContactOutcome,
  type LeadInterestLevel,
  type LeadPoolFilters,
  type LeadPoolRow,
  type LeadPoolScope,
  type LeadPageSize,
  type LeadStatus,
} from "./lead-contract";
import type { InvitationKind, InvitationState } from "./invitation-contract";

interface LeadDbRow {
  id: string;
  provisional_student_name: string;
  phone: string;
  grade_hint: number | null;
  grade_text: string;
  status: LeadStatus | "unassigned";
  owner_id: string | null;
  suggested_student_id: string | null;
  created_at: string;
}

interface LeadSourceDbRow {
  id: string;
  lead_id: string;
  submitted_at: string | null;
  acquisition_method: string;
  promoter: string;
  location_text: string;
  source_marked_duplicate: boolean;
  created_at: string;
}

interface LeadInterestDbRow {
  lead_id: string;
  label: string;
}

interface LeadCommunicationDbRow {
  id: string;
  lead_id: string;
  outcome: LeadContactOutcome;
  note: string;
  wechat_added: boolean | null;
  visit_committed: boolean | null;
  interest_level: LeadInterestLevel | null;
  occurred_at: string;
}

interface LeadInvitationDbRow {
  id: string;
  lead_id: string;
  kind: InvitationKind;
  state: InvitationState;
  activity_id: string | null;
  assessor_id: string | null;
  proposed_time_text: string;
  parent_time_options?: string[];
  assessor_time_options?: string[];
  scheduled_at?: string | null;
  location_text: string;
  updated_at: string;
}

interface LeadNextActionDbRow {
  lead_id: string;
  due_at: string;
}

function pickParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseLeadPoolFilters(
  searchParams: Record<string, string | string[] | undefined>,
  canScopeAll: boolean,
): LeadPoolFilters {
  const requestedScope = pickParam(searchParams.scope);
  const status = pickParam(searchParams.status);
  const page = Math.max(1, Number(pickParam(searchParams.page)) || 1);
  const pageSize = parseLeadPageSize(searchParams.pageSize);
  const scope: LeadPoolScope = requestedScope === "mine"
    ? "mine"
    : requestedScope === "unassigned"
      ? "unassigned"
      : canScopeAll ? "all" : "mine";
  return {
    scope,
    status: LEAD_STATUSES.includes(status as LeadStatus) ? status as LeadStatus : undefined,
    q: pickParam(searchParams.q)?.trim().slice(0, 80) || undefined,
    page,
    pageSize,
  };
}

export function leadSearchFilter(raw: string): string {
  const escaped = raw.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const clauses = [
    `provisional_student_name.ilike.%${escaped}%`,
    `phone.ilike.%${escaped}%`,
    `phone_normalized.ilike.%${escaped}%`,
  ];
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 3 && digits !== raw) clauses.push(`phone_normalized.ilike.%${digits}%`);
  return clauses.join(",");
}

function sourceTimestamp(row: LeadSourceDbRow): number {
  return new Date(row.submitted_at ?? row.created_at).getTime();
}

export async function listLeadPool(
  userId: string,
  filters: LeadPoolFilters,
  selectedLeadIds?: readonly string[],
): Promise<{ leads: LeadPoolRow[]; count: number; pageSize: LeadPageSize }> {
  if (selectedLeadIds?.length === 0) return { leads: [], count: 0, pageSize: filters.pageSize };
  const supabase = await createClient();
  const offset = selectedLeadIds ? 0 : (filters.page - 1) * filters.pageSize;
  let query = supabase
    .from("leads")
    .select(
      "id,provisional_student_name,phone,grade_hint,grade_text,status,owner_id,suggested_student_id,created_at",
      { count: "exact" },
    );
  if (filters.scope === "unassigned") query = query.is("owner_id", null);
  if (filters.scope === "mine") query = query.eq("owner_id", userId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.q) query = query.or(leadSearchFilter(filters.q));
  if (selectedLeadIds) query = query.in("id", [...selectedLeadIds]);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + (selectedLeadIds?.length ?? filters.pageSize) - 1)
    .returns<LeadDbRow[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const leadIds = rows.map((row) => row.id);
  if (leadIds.length === 0) return { leads: [], count: count ?? 0, pageSize: filters.pageSize };

  const ownerIds = [...new Set(rows.map((row) => row.owner_id).filter((id): id is string => Boolean(id)))];
  const suggestedStudentIds = [...new Set(rows
    .map((row) => row.suggested_student_id)
    .filter((id): id is string => Boolean(id)))];
  const [sourceResult, interestResult, communicationResult, initialInvitationResult, reminderResult, ownerResult, studentResult] = await Promise.all([
    supabase
      .from("lead_source_records")
      .select("id,lead_id,submitted_at,acquisition_method,promoter,location_text,source_marked_duplicate,created_at")
      .in("lead_id", leadIds)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(5_000)
      .returns<LeadSourceDbRow[]>(),
    supabase
      .from("lead_interest_selections")
      .select("lead_id,label")
      .in("lead_id", leadIds)
      .limit(5_000)
      .returns<LeadInterestDbRow[]>(),
    supabase
      .from("effective_lead_communications" as "lead_communications")
      .select("id,lead_id,outcome,note,wechat_added,visit_committed,interest_level,occurred_at")
      .in("lead_id", leadIds)
      .order("original_occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(5_000)
      .returns<LeadCommunicationDbRow[]>(),
    supabase
      .from("lead_invitation_threads")
      .select("id,lead_id,kind,state,activity_id,assessor_id,proposed_time_text,parent_time_options,assessor_time_options,scheduled_at,location_text,updated_at")
      .in("lead_id", leadIds)
      .not("state", "in", "(completed,cancelled)")
      .order("updated_at", { ascending: false })
      .limit(5_000)
      .returns<LeadInvitationDbRow[]>(),
    supabase
      .from("lead_next_actions")
      .select("lead_id,due_at")
      .in("lead_id", leadIds)
      .eq("status", "open")
      .neq("kind", "initial_contact")
      .returns<LeadNextActionDbRow[]>(),
    ownerIds.length > 0
      ? supabase.from("profiles").select("id,display_name").in("id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    suggestedStudentIds.length > 0
      ? supabase.from("students").select("id,name").in("id", suggestedStudentIds).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  let invitationResult = initialInvitationResult;
  if (invitationResult.error?.code === "PGRST204"
      || invitationResult.error?.code === "42703"
      || invitationResult.error?.message?.includes("parent_time_options")) {
    invitationResult = await supabase
      .from("lead_invitation_threads")
      .select("id,lead_id,kind,state,activity_id,assessor_id,proposed_time_text,location_text,updated_at")
      .in("lead_id", leadIds)
      .not("state", "in", "(completed,cancelled)")
      .order("updated_at", { ascending: false })
      .limit(5_000)
      .returns<LeadInvitationDbRow[]>();
  }
  if (sourceResult.error) throw new Error(sourceResult.error.message);
  if (interestResult.error) throw new Error(interestResult.error.message);
  if (communicationResult.error) throw new Error(communicationResult.error.message);
  if (reminderResult.error) throw new Error(reminderResult.error.message);
  const invitationUnavailable = invitationResult.error?.code === "42P01"
    || invitationResult.error?.code === "PGRST205";
  if (invitationResult.error && !invitationUnavailable) throw new Error(invitationResult.error.message);
  if (ownerResult.error) throw new Error(ownerResult.error.message);
  if (studentResult.error) throw new Error(studentResult.error.message);

  const sourcesByLead = new Map<string, LeadSourceDbRow[]>();
  for (const source of sourceResult.data ?? []) {
    const entries = sourcesByLead.get(source.lead_id) ?? [];
    entries.push(source);
    sourcesByLead.set(source.lead_id, entries);
  }
  for (const sources of sourcesByLead.values()) sources.sort((a, b) => sourceTimestamp(b) - sourceTimestamp(a));

  const interestsByLead = new Map<string, string[]>();
  for (const interest of interestResult.data ?? []) {
    const labels = interestsByLead.get(interest.lead_id) ?? [];
    if (!labels.includes(interest.label)) labels.push(interest.label);
    interestsByLead.set(interest.lead_id, labels);
  }
  const ownerNames = new Map((ownerResult.data ?? []).map((row) => [row.id, row.display_name]));
  const studentNames = new Map((studentResult.data ?? []).map((row) => [row.id, row.name]));
  const reminderByLead = new Map((reminderResult.data ?? []).map((row) => [row.lead_id, row.due_at]));
  const invitationByLead = new Map<string, LeadInvitationDbRow>();
  for (const invitation of invitationResult.data ?? []) {
    if (!invitationByLead.has(invitation.lead_id)) invitationByLead.set(invitation.lead_id, invitation);
  }
  const invitationActivityIds = [...new Set([...invitationByLead.values()]
    .map((row) => row.activity_id)
    .filter((id): id is string => Boolean(id)))];
  const invitationAssessorIds = [...new Set([...invitationByLead.values()]
    .map((row) => row.assessor_id)
    .filter((id): id is string => Boolean(id)))];
  const [invitationActivityResult, invitationAssessorResult] = await Promise.all([
    invitationActivityIds.length > 0
      ? supabase.from("activities").select("id,title,scheduled_at").in("id", invitationActivityIds)
      : Promise.resolve({ data: [], error: null }),
    invitationAssessorIds.length > 0
      ? supabase.from("profiles").select("id,display_name").in("id", invitationAssessorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (invitationActivityResult.error) throw new Error(invitationActivityResult.error.message);
  if (invitationAssessorResult.error) throw new Error(invitationAssessorResult.error.message);
  const invitationActivities = new Map((invitationActivityResult.data ?? []).map((row) => [row.id, row]));
  const invitationAssessors = new Map((invitationAssessorResult.data ?? []).map((row) => [row.id, row.display_name]));
  const communicationsByLead = new Map<string, LeadCommunicationDbRow[]>();
  for (const communication of communicationResult.data ?? []) {
    const entries = communicationsByLead.get(communication.lead_id) ?? [];
    entries.push(communication);
    communicationsByLead.set(communication.lead_id, entries);
  }
  // 保留查询的原录入顺序；更正历史发生时间不改变当前最新沟通事实。

  return {
    count: count ?? 0,
    pageSize: filters.pageSize,
    leads: rows.map((row) => {
      const sources = sourcesByLead.get(row.id) ?? [];
      const latest = sources[0];
      const communications = communicationsByLead.get(row.id) ?? [];
      const lastContact = communications[0];
      const invitation = invitationByLead.get(row.id);
      const invitationActivity = invitation?.activity_id
        ? invitationActivities.get(invitation.activity_id)
        : undefined;
      const nextContactAt = reminderByLead.get(row.id) ?? null;
      return {
        id: row.id,
        provisionalStudentName: row.provisional_student_name,
        phone: row.phone,
        gradeHint: row.grade_hint,
        gradeText: row.grade_text,
        // The former `unassigned` value mixed ownership with contact progress.
        // Normalize legacy rows immediately so the UI remains correct before the
        // semantic cleanup migration is applied to a development database.
        status: row.status === "unassigned" ? "uncontacted" : row.status,
        ownerId: row.owner_id,
        ownerName: row.owner_id ? ownerNames.get(row.owner_id) ?? "" : "",
        suggestedStudentId: row.suggested_student_id,
        suggestedStudentName: row.suggested_student_id
          ? studentNames.get(row.suggested_student_id) ?? ""
          : "",
        createdAt: row.created_at,
        acquiredAt: latest?.submitted_at ?? null,
        acquisitionLocation: latest?.location_text ?? "",
        acquisitionMethod: latest?.acquisition_method ?? "",
        acquisitionPromoter: latest?.promoter ?? "",
        sourceCount: sources.length,
        sourceMarkedDuplicate: latest?.source_marked_duplicate ?? false,
        interests: interestsByLead.get(row.id) ?? [],
        contactCount: communications.length,
        lastContactAt: lastContact?.occurred_at ?? null,
        lastContactOutcome: lastContact?.outcome ?? null,
        lastContactNote: lastContact?.note ?? "",
        wechatAdded: lastContact?.wechat_added ?? null,
        visitCommitted: lastContact?.visit_committed ?? null,
        interestLevel: lastContact?.interest_level ?? null,
        nextContactAt,
        activeInvitation: invitation ? {
          id: invitation.id,
          kind: invitation.kind,
          state: invitation.state,
          activityId: invitation.activity_id,
          activityTitle: invitationActivity?.title ?? "",
          activityScheduledAt: invitationActivity?.scheduled_at ?? null,
          assessorId: invitation.assessor_id,
          assessorName: invitation.assessor_id ? invitationAssessors.get(invitation.assessor_id) ?? "" : "",
          legacyTimeText: invitation.proposed_time_text,
          parentTimeOptions: invitation.parent_time_options ?? [],
          assessorTimeOptions: invitation.assessor_time_options ?? [],
          scheduledAt: invitation.scheduled_at ?? null,
          locationText: invitation.location_text,
          updatedAt: invitation.updated_at,
          nextContactAt,
        } : null,
      };
    }),
  };
}
