import { createClient } from "@/lib/supabase/server";

export const LEAD_STATUSES = [
  "unassigned",
  "uncontacted",
  "contacted",
  "nurture",
  "intent_confirmed",
  "invalid",
  "converted",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadPoolScope = "unassigned" | "mine" | "all";

export interface LeadPoolFilters {
  scope: LeadPoolScope;
  status?: LeadStatus;
  q?: string;
  page: number;
}

export interface LeadPoolRow {
  id: string;
  provisionalStudentName: string;
  phone: string;
  gradeHint: number | null;
  gradeText: string;
  status: LeadStatus;
  ownerId: string | null;
  ownerName: string;
  suggestedStudentId: string | null;
  suggestedStudentName: string;
  createdAt: string;
  sourceCount: number;
  sourceBatchLabel: string;
  sourceRow: number | null;
  submittedAt: string | null;
  promoter: string;
  acquisitionMethod: string;
  location: string;
  sourceMarkedDuplicate: boolean;
  interests: string[];
  contactCount: number;
  lastContactAt: string | null;
  lastContactOutcome: LeadContactOutcome | null;
  lastContactNote: string;
  wechatAdded: boolean | null;
  visitCommitted: boolean | null;
  interestLevel: LeadInterestLevel | null;
  nextActionKind: LeadNextActionKind | null;
  nextActionAt: string | null;
}

export type LeadContactOutcome = "unreachable" | "connected" | "declined" | "invalid_number";
export type LeadInterestLevel = "A" | "B" | "C";
export type LeadNextActionKind = "initial_contact" | "retry" | "wechat_followup" | "visit_confirmation" | "nurture" | "other";

interface LeadDbRow {
  id: string;
  provisional_student_name: string;
  phone: string;
  grade_hint: number | null;
  grade_text: string;
  status: LeadStatus;
  owner_id: string | null;
  suggested_student_id: string | null;
  created_at: string;
}

interface LeadSourceDbRow {
  id: string;
  lead_id: string;
  batch_label: string;
  source_row: number;
  submitted_at: string | null;
  promoter: string;
  acquisition_method: string;
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

interface LeadNextActionDbRow {
  lead_id: string;
  kind: LeadNextActionKind;
  due_at: string;
}

const PAGE_SIZE = 100;

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
  const scope: LeadPoolScope = requestedScope === "mine"
    ? "mine"
    : requestedScope === "all" && canScopeAll
      ? "all"
      : "unassigned";
  return {
    scope,
    status: LEAD_STATUSES.includes(status as LeadStatus) ? status as LeadStatus : undefined,
    q: pickParam(searchParams.q)?.trim().slice(0, 80) || undefined,
    page,
  };
}

function leadSearchFilter(raw: string): string {
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
): Promise<{ leads: LeadPoolRow[]; count: number; pageSize: number }> {
  const supabase = await createClient();
  const offset = (filters.page - 1) * PAGE_SIZE;
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

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)
    .returns<LeadDbRow[]>();
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const leadIds = rows.map((row) => row.id);
  if (leadIds.length === 0) return { leads: [], count: count ?? 0, pageSize: PAGE_SIZE };

  const ownerIds = [...new Set(rows.map((row) => row.owner_id).filter((id): id is string => Boolean(id)))];
  const suggestedStudentIds = [...new Set(rows
    .map((row) => row.suggested_student_id)
    .filter((id): id is string => Boolean(id)))];
  const [sourceResult, interestResult, communicationResult, nextActionResult, ownerResult, studentResult] = await Promise.all([
    supabase
      .from("lead_source_records")
      .select("id,lead_id,batch_label,source_row,submitted_at,promoter,acquisition_method,location_text,source_marked_duplicate,created_at")
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
      .from("lead_communications")
      .select("id,lead_id,outcome,note,wechat_added,visit_committed,interest_level,occurred_at")
      .in("lead_id", leadIds)
      .order("occurred_at", { ascending: false })
      .limit(5_000)
      .returns<LeadCommunicationDbRow[]>(),
    supabase
      .from("lead_next_actions")
      .select("lead_id,kind,due_at")
      .in("lead_id", leadIds)
      .eq("status", "open")
      .limit(500)
      .returns<LeadNextActionDbRow[]>(),
    ownerIds.length > 0
      ? supabase.from("profiles").select("id,display_name").in("id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    suggestedStudentIds.length > 0
      ? supabase.from("students").select("id,name").in("id", suggestedStudentIds).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sourceResult.error) throw new Error(sourceResult.error.message);
  if (interestResult.error) throw new Error(interestResult.error.message);
  if (communicationResult.error) throw new Error(communicationResult.error.message);
  if (nextActionResult.error) throw new Error(nextActionResult.error.message);
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
  const communicationsByLead = new Map<string, LeadCommunicationDbRow[]>();
  for (const communication of communicationResult.data ?? []) {
    const entries = communicationsByLead.get(communication.lead_id) ?? [];
    entries.push(communication);
    communicationsByLead.set(communication.lead_id, entries);
  }
  for (const communications of communicationsByLead.values()) {
    communications.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
  }
  const nextActionByLead = new Map((nextActionResult.data ?? []).map((row) => [row.lead_id, row]));

  return {
    count: count ?? 0,
    pageSize: PAGE_SIZE,
    leads: rows.map((row) => {
      const sources = sourcesByLead.get(row.id) ?? [];
      const latest = sources[0];
      const communications = communicationsByLead.get(row.id) ?? [];
      const lastContact = communications[0];
      const nextAction = nextActionByLead.get(row.id);
      return {
        id: row.id,
        provisionalStudentName: row.provisional_student_name,
        phone: row.phone,
        gradeHint: row.grade_hint,
        gradeText: row.grade_text,
        status: row.status,
        ownerId: row.owner_id,
        ownerName: row.owner_id ? ownerNames.get(row.owner_id) ?? "" : "",
        suggestedStudentId: row.suggested_student_id,
        suggestedStudentName: row.suggested_student_id
          ? studentNames.get(row.suggested_student_id) ?? ""
          : "",
        createdAt: row.created_at,
        sourceCount: sources.length,
        sourceBatchLabel: latest?.batch_label ?? "",
        sourceRow: latest?.source_row ?? null,
        submittedAt: latest?.submitted_at ?? null,
        promoter: latest?.promoter ?? "",
        acquisitionMethod: latest?.acquisition_method ?? "",
        location: latest?.location_text ?? "",
        sourceMarkedDuplicate: latest?.source_marked_duplicate ?? false,
        interests: interestsByLead.get(row.id) ?? [],
        contactCount: communications.length,
        lastContactAt: lastContact?.occurred_at ?? null,
        lastContactOutcome: lastContact?.outcome ?? null,
        lastContactNote: lastContact?.note ?? "",
        wechatAdded: lastContact?.wechat_added ?? null,
        visitCommitted: lastContact?.visit_committed ?? null,
        interestLevel: lastContact?.interest_level ?? null,
        nextActionKind: nextAction?.kind ?? null,
        nextActionAt: nextAction?.due_at ?? null,
      };
    }),
  };
}
