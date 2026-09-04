import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  INVITATION_COORDINATION_STATES,
  invitationCoordinationStageFrom,
  invitationQueueFrom,
  type InvitationActivityOption,
  type InvitationAssessorOption,
  type InvitationChannel,
  type InvitationCoordinationRow,
  type InvitationFilters,
  type InvitationKind,
  type InvitationQueueCounts,
  type InvitationState,
} from "./invitation-contract";

interface InvitationDbRow {
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
  summary: string;
  updated_at: string;
}

interface InvitationLeadDbRow {
  id: string;
  provisional_student_name: string;
  phone: string;
  grade_hint: number | null;
  grade_text: string;
  owner_id: string | null;
}

interface InvitationEventDbRow {
  id: string;
  invitation_id: string;
  from_state: InvitationState | null;
  to_state: InvitationState;
  channel: InvitationChannel;
  note: string;
  recorded_by: string;
  occurred_at: string;
}

interface ActivityDbRow {
  id: string;
  kind: string;
  title: string;
  scheduled_at: string;
  location: string;
}

function pickParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function relationUnavailable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST202" || error?.code === "PGRST205"
    || Boolean(error?.message?.includes("invitation_"));
}

export function parseInvitationFilters(
  searchParams: Record<string, string | string[] | undefined>,
): InvitationFilters {
  const queue = invitationQueueFrom(searchParams.queue);
  return {
    queue,
    stage: queue === "coordination"
      ? invitationCoordinationStageFrom(searchParams.queue, searchParams.stage)
      : "all",
    q: pickParam(searchParams.q)?.trim().slice(0, 80) || undefined,
  };
}

export async function listInvitationQueueCounts(): Promise<InvitationQueueCounts> {
  const empty: InvitationQueueCounts = {
    queues: { coordination: 0, confirmed: 0, waiting_activity: 0, closed: 0 },
    stages: { all: 0, coordinating_time: 0, awaiting_teacher: 0, awaiting_parent: 0 },
  };
  const supabase = await createClient();
  const countStates = (states: readonly InvitationState[]) => supabase
    .from("lead_invitation_threads")
    .select("id", { count: "exact", head: true })
    .in("state", [...states]);
  const [coordinating, teacher, parent, confirmed, waitingActivity, closed] = await Promise.all([
    countStates(["coordinating_time"]),
    countStates(["awaiting_teacher"]),
    countStates(["awaiting_parent"]),
    countStates(["confirmed"]),
    countStates(["waiting_activity"]),
    countStates(["completed", "cancelled"]),
  ]);
  const results = [coordinating, teacher, parent, confirmed, waitingActivity, closed];
  const unexpectedError = results.find((result) => result.error && !relationUnavailable(result.error))?.error;
  if (unexpectedError) throw new Error(unexpectedError.message);
  if (results.some((result) => result.error)) return empty;
  const coordinationCounts = {
    coordinating_time: coordinating.count ?? 0,
    awaiting_teacher: teacher.count ?? 0,
    awaiting_parent: parent.count ?? 0,
  };
  const coordinationTotal = Object.values(coordinationCounts).reduce((sum, count) => sum + count, 0);
  return {
    queues: {
      coordination: coordinationTotal,
      confirmed: confirmed.count ?? 0,
      waiting_activity: waitingActivity.count ?? 0,
      closed: closed.count ?? 0,
    },
    stages: {
      all: coordinationTotal,
      ...coordinationCounts,
    },
  };
}

export async function listInvitationOptions(): Promise<{
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
}> {
  const supabase = await createClient();
  const oldestVisible = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [activityResult, assessorResult] = await Promise.all([
    supabase
      .from("activities")
      .select("id,kind,title,scheduled_at,location")
      .is("deleted_at", null)
      .gte("scheduled_at", oldestVisible)
      .order("scheduled_at", { ascending: true })
      .limit(100)
      .returns<ActivityDbRow[]>(),
    supabase.rpc("list_invitation_assessors"),
  ]);
  if (activityResult.error) throw new Error(activityResult.error.message);
  if (assessorResult.error && !relationUnavailable(assessorResult.error)) {
    throw new Error(assessorResult.error.message);
  }
  return {
    activities: (activityResult.data ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      scheduledAt: row.scheduled_at,
      location: row.location,
    })),
    assessors: (assessorResult.data ?? []).map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
    })),
  };
}

export async function listInvitationCoordination(
  filters: InvitationFilters,
): Promise<InvitationCoordinationRow[]> {
  const supabase = await createClient();
  let invitationQuery = supabase
    .from("lead_invitation_threads")
    .select("id,lead_id,kind,state,activity_id,assessor_id,proposed_time_text,parent_time_options,assessor_time_options,scheduled_at,location_text,summary,updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (filters.queue === "closed") {
    invitationQuery = invitationQuery.in("state", ["completed", "cancelled"]);
  } else if (filters.queue === "coordination") {
    invitationQuery = filters.stage === "all"
      ? invitationQuery.in("state", [...INVITATION_COORDINATION_STATES])
      : invitationQuery.eq("state", filters.stage);
  } else {
    invitationQuery = invitationQuery.eq("state", filters.queue);
  }
  let invitationResult = await invitationQuery.returns<InvitationDbRow[]>();
  if (invitationResult.error?.code === "PGRST204"
      || invitationResult.error?.code === "42703"
      || invitationResult.error?.message?.includes("parent_time_options")) {
    let legacyQuery = supabase
      .from("lead_invitation_threads")
      .select("id,lead_id,kind,state,activity_id,assessor_id,proposed_time_text,location_text,summary,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (filters.queue === "closed") {
      legacyQuery = legacyQuery.in("state", ["completed", "cancelled"]);
    } else if (filters.queue === "coordination") {
      legacyQuery = filters.stage === "all"
        ? legacyQuery.in("state", [...INVITATION_COORDINATION_STATES])
        : legacyQuery.eq("state", filters.stage);
    } else {
      legacyQuery = legacyQuery.eq("state", filters.queue);
    }
    invitationResult = await legacyQuery.returns<InvitationDbRow[]>();
  }
  if (invitationResult.error) {
    if (relationUnavailable(invitationResult.error)) return [];
    throw new Error(invitationResult.error.message);
  }
  const invitations = invitationResult.data ?? [];
  if (invitations.length === 0) return [];

  const leadIds = [...new Set(invitations.map((row) => row.lead_id))];
  const activityIds = [...new Set(invitations.map((row) => row.activity_id).filter((id): id is string => Boolean(id)))];
  const assessorIds = [...new Set(invitations.map((row) => row.assessor_id).filter((id): id is string => Boolean(id)))];
  const invitationIds = invitations.map((row) => row.id);
  const [leadResult, activityResult, assessorResult, eventResult] = await Promise.all([
    supabase
      .from("leads")
      .select("id,provisional_student_name,phone,grade_hint,grade_text,owner_id")
      .in("id", leadIds)
      .returns<InvitationLeadDbRow[]>(),
    activityIds.length > 0
      ? supabase.from("activities").select("id,kind,title,scheduled_at,location").in("id", activityIds).returns<ActivityDbRow[]>()
      : Promise.resolve({ data: [], error: null }),
    assessorIds.length > 0
      ? supabase.from("profiles").select("id,display_name").in("id", assessorIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("lead_invitation_events")
      .select("id,invitation_id,from_state,to_state,channel,note,recorded_by,occurred_at")
      .in("invitation_id", invitationIds)
      .order("occurred_at", { ascending: false })
      .limit(5_000)
      .returns<InvitationEventDbRow[]>(),
  ]);
  if (leadResult.error) throw new Error(leadResult.error.message);
  if (activityResult.error) throw new Error(activityResult.error.message);
  if (assessorResult.error) throw new Error(assessorResult.error.message);
  if (eventResult.error) throw new Error(eventResult.error.message);

  const leads = leadResult.data ?? [];
  const ownerIds = [...new Set(leads.map((row) => row.owner_id).filter((id): id is string => Boolean(id)))];
  const eventRecorderIds = [...new Set((eventResult.data ?? []).map((row) => row.recorded_by))];
  const profileIds = [...new Set([...ownerIds, ...eventRecorderIds])];
  const profileResult = profileIds.length > 0
    ? await supabase.from("profiles").select("id,display_name").in("id", profileIds)
    : { data: [], error: null };
  if (profileResult.error) throw new Error(profileResult.error.message);

  const leadById = new Map(leads.map((row) => [row.id, row]));
  const activityById = new Map((activityResult.data ?? []).map((row) => [row.id, row]));
  const assessorById = new Map((assessorResult.data ?? []).map((row) => [row.id, row.display_name]));
  const profileById = new Map((profileResult.data ?? []).map((row) => [row.id, row.display_name]));
  const eventsByInvitation = new Map<string, InvitationEventDbRow[]>();
  for (const event of eventResult.data ?? []) {
    const rows = eventsByInvitation.get(event.invitation_id) ?? [];
    if (rows.length < 3) rows.push(event);
    eventsByInvitation.set(event.invitation_id, rows);
  }
  const normalizedQuery = filters.q?.toLocaleLowerCase();

  return invitations.flatMap((invitation) => {
    const lead = leadById.get(invitation.lead_id);
    if (!lead) return [];
    const activity = invitation.activity_id ? activityById.get(invitation.activity_id) : undefined;
    const searchable = [lead.provisional_student_name, lead.phone, activity?.title ?? "", invitation.summary]
      .join(" ")
      .toLocaleLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) return [];
    return [{
      id: invitation.id,
      leadId: lead.id,
      leadName: lead.provisional_student_name,
      phone: lead.phone,
      gradeText: lead.grade_text || (lead.grade_hint ? String(lead.grade_hint) : ""),
      ownerName: lead.owner_id ? profileById.get(lead.owner_id) ?? "" : "",
      kind: invitation.kind,
      state: invitation.state,
      activityId: invitation.activity_id,
      activityTitle: activity?.title ?? "",
      activityScheduledAt: activity?.scheduled_at ?? null,
      assessorId: invitation.assessor_id,
      assessorName: invitation.assessor_id ? assessorById.get(invitation.assessor_id) ?? "" : "",
      legacyTimeText: invitation.proposed_time_text,
      parentTimeOptions: invitation.parent_time_options ?? [],
      assessorTimeOptions: invitation.assessor_time_options ?? [],
      scheduledAt: invitation.scheduled_at ?? null,
      locationText: invitation.location_text || activity?.location || "",
      summary: invitation.summary,
      updatedAt: invitation.updated_at,
      events: (eventsByInvitation.get(invitation.id) ?? []).map((event) => ({
        id: event.id,
        fromState: event.from_state,
        toState: event.to_state,
        channel: event.channel,
        note: event.note,
        recordedByName: profileById.get(event.recorded_by) ?? "",
        occurredAt: event.occurred_at,
      })),
    }];
  });
}
