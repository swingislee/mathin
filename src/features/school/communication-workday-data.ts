import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActivityEnrollmentContext } from "./enrollment-workflow-contract";
import type { LeadPoolScope } from "./lead-contract";
import type { InvitationCoordinationRow } from "./invitation-contract";
import { readSchoolQueryBatches, readSchoolQueryPages } from "./school-query-pages";
import { communicationDayBounds, type CommunicationDayEvent, type CommunicationDayTask, type CommunicationWorkday, type CommunicationWorklist } from "./communication-workday-contract";

interface EffectiveEvent {
  id: string; lead_id?: string; invitation_id?: string; registration_id?: string;
  channel: string; outcome?: string; to_state?: string; note: string;
  recorded_by: string; occurred_at: string; original_occurred_at: string;
  revision_id: string | null; revised_at: string | null; can_revise: boolean;
  wechat_added?: boolean | null; visit_committed?: boolean | null; interest_level?: "A" | "B" | "C" | null;
  route?: string; next_contact_at?: string | null;
}
interface NextAction {
  id: string; lead_id: string; kind: string; due_at: string; created_at: string; completed_at: string | null;
}
const scopeMatches = (scope: LeadPoolScope, ownerId: string | null, userId: string) => scope === "all" || (scope === "mine" ? ownerId === userId : ownerId === null);

export async function loadCommunicationWorkday(userId: string, scope: LeadPoolScope, date: string, postRows: ActivityEnrollmentContext[] = [], canViewLeads = true, invitationRows: InvitationCoordinationRow[] = []): Promise<CommunicationWorkday> {
  const { start, end } = communicationDayBounds(date);
  const supabase = await createClient();
  // 三个只读 effective 视图与工作单迁移一起提供；沿用现有 PostgREST 查询构造器。
  const effective = (table: "effective_lead_communications" | "effective_lead_invitation_events" | "effective_activity_followup_contacts") => supabase.from(table as "lead_communications");
  const readDay = (table: Parameters<typeof effective>[0]) => readSchoolQueryPages<EffectiveEvent>((offset, last) => {
    let query = effective(table).select("*").gte("occurred_at", start).lt("occurred_at", end);
    if (scope === "mine") query = query.eq("recorded_by", userId);
    return query.order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(offset, last).returns<EffectiveEvent[]>();
  });
  const [contacts, invitationEvents, postEvents, actions, owners] = await Promise.all([
    canViewLeads ? readDay("effective_lead_communications") : Promise.resolve({ data: [] as EffectiveEvent[], error: null }),
    readDay("effective_lead_invitation_events"),
    canViewLeads ? readDay("effective_activity_followup_contacts") : Promise.resolve({ data: [] as EffectiveEvent[], error: null }),
    canViewLeads ? readSchoolQueryPages<NextAction>((offset, last) => supabase.from("lead_next_actions")
      .select("id,lead_id,kind,due_at,created_at,completed_at").neq("kind", "initial_contact")
      .neq("status", "cancelled")
      .lt("created_at", end).lt("due_at", end).or(`completed_at.is.null,completed_at.gte.${start}`)
      .order("due_at", { ascending: true }).order("id", { ascending: true }).range(offset, last).returns<NextAction[]>())
      : Promise.resolve({ data: [] as NextAction[], error: null }),
    canViewLeads ? readSchoolQueryPages((offset, last) => supabase.from("leads").select("id,owner_id")
      .order("id", { ascending: true }).range(offset, last)) : Promise.resolve({ data: [] as { id: string; owner_id: string | null }[], error: null }),
  ]);
  for (const result of [contacts, invitationEvents, postEvents, actions, owners]) if (result.error) throw new Error(result.error.message);
  const ownerByLead = new Map((owners.data ?? []).map((row) => [row.id, row.owner_id]));
  const invitationIds = (invitationEvents.data ?? []).flatMap((event) => event.invitation_id ? [event.invitation_id] : []);
  const invitationLeads = await readSchoolQueryBatches(invitationIds, (batch, offset, last) => supabase.from("lead_invitation_threads")
    .select("id,lead_id").in("id", batch).order("id", { ascending: true }).range(offset, last));
  if (invitationLeads.error) throw new Error(invitationLeads.error.message);
  const leadByInvitation = new Map((invitationLeads.data ?? []).map((row) => [row.id, row.lead_id]));
  const allEvents = [...contacts.data ?? [], ...invitationEvents.data ?? [], ...postEvents.data ?? []];
  const profiles = await readSchoolQueryBatches(allEvents.map((event) => event.recorded_by), (batch, offset, last) => supabase.from("profiles")
    .select("id,display_name").in("id", batch).order("id", { ascending: true }).range(offset, last));
  if (profiles.error) throw new Error(profiles.error.message);
  const names = new Map((profiles.data ?? []).map((row) => [row.id, row.display_name]));
  const mapEvent = (event: EffectiveEvent, source: CommunicationDayEvent["source"], key: string): CommunicationDayEvent => ({
    id: event.id, source, key, occurredAt: event.occurred_at, recordedAt: event.original_occurred_at ?? event.occurred_at,
    recordedById: event.recorded_by, recordedByName: names.get(event.recorded_by) ?? "",
    channel: event.channel, outcome: event.outcome ?? event.to_state ?? "", note: event.note,
    revisionId: event.revision_id ?? null, revisedAt: event.revised_at ?? null, canRevise: event.can_revise === true,
    ...(source === "contact" ? { wechatAdded: event.wechat_added ?? null, visitCommitted: event.visit_committed ?? null, interestLevel: event.interest_level ?? null } : {}),
    ...(source === "post_activity" ? { route: event.route, nextContactAt: event.next_contact_at ?? null } : {}),
  });
  const events = [
    ...(contacts.data ?? []).flatMap((event) => event.lead_id ? [mapEvent(event, "contact", `lead:${event.lead_id}`)] : []),
    ...(invitationEvents.data ?? []).flatMap((event) => {
      const leadId = event.invitation_id ? leadByInvitation.get(event.invitation_id) : null;
      return leadId ? [mapEvent(event, "invitation", `lead:${leadId}`)] : [];
    }),
    ...(postEvents.data ?? []).flatMap((event) => event.registration_id ? [mapEvent(event, "post_activity", `post:${event.registration_id}`)] : []),
  ];
  const postById = new Map(postRows.map((row) => [row.registrationId, row]));
  const scopedEvents = scope === "unassigned" ? events.filter((event) => event.key.startsWith("lead:")
    ? ownerByLead.get(event.key.slice(5)) === null : postById.get(event.key.slice(5))?.ownerId === null) : events;
  const tasks: CommunicationDayTask[] = (actions.data ?? []).filter((action) => ownerByLead.has(action.lead_id)
    && scopeMatches(scope, ownerByLead.get(action.lead_id) ?? null, userId)).map((action) => ({
    key: `lead:${action.lead_id}`, dueAt: action.due_at, createdAt: action.created_at, completedAt: action.completed_at, kind: action.kind,
  }));
  const postTaskIds = postRows.filter((row) => scopeMatches(scope, row.ownerId, userId)).map((row) => row.registrationId);
  const enrollmentIds = postRows.filter((row) => postTaskIds.includes(row.registrationId)).flatMap((row) => row.enrollmentId ? [row.enrollmentId] : []);
  const enrollments = await readSchoolQueryBatches(enrollmentIds, (batch, offset, last) => supabase.from("course_enrollments")
    .select("id,confirmed_at").in("id", batch).order("id", { ascending: true }).range(offset, last));
  if (enrollments.error) throw new Error(enrollments.error.message);
  const enrollmentConfirmedAt = new Map((enrollments.data ?? []).map((row) => [row.id, row.confirmed_at]));
  const postHistory = canViewLeads ? await readSchoolQueryBatches<EffectiveEvent>(postTaskIds, (batch, offset, last) => effective("effective_activity_followup_contacts")
    .select("*").in("registration_id", batch)
    .order("original_occurred_at", { ascending: true }).order("id", { ascending: true }).range(offset, last).returns<EffectiveEvent[]>()) : { data: [], error: null };
  if (postHistory.error) throw new Error(postHistory.error.message);
  const historyByRegistration = new Map<string, EffectiveEvent[]>();
  for (const event of postHistory.data ?? []) {
    if (!event.registration_id) continue;
    const history = historyByRegistration.get(event.registration_id) ?? [];
    history.push(event); historyByRegistration.set(event.registration_id, history);
  }
  for (const [registrationId, history] of historyByRegistration) {
    const currentPost = postById.get(registrationId);
    const enrolledAt = currentPost?.enrollmentId ? enrollmentConfirmedAt.get(currentPost.enrollmentId) : undefined;
    history.forEach((event, index) => {
      if (Date.parse(event.original_occurred_at) >= Date.parse(end)) return;
      const nextRecordedAt = history[index + 1]?.original_occurred_at ?? null;
      // 报名确认是已有事实；若 RLS 不开放确认日期，仅保留可证明的历史区间和当日记录。
      if (!nextRecordedAt && ((currentPost?.enrollmentId && !enrolledAt) || (currentPost?.route === "closed" && event.route !== "closed"))) return;
      const completionTimes = [nextRecordedAt, enrolledAt].filter((value): value is string => Boolean(value));
      const completedAt = completionTimes.sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
      if (completedAt && Date.parse(completedAt) < Date.parse(event.original_occurred_at)) return;
      if (event.next_contact_at && event.route !== "closed" && Date.parse(event.next_contact_at) < Date.parse(end)
        && (!completedAt || Date.parse(completedAt) >= Date.parse(start))) tasks.push({
        key: `post:${registrationId}`, dueAt: event.next_contact_at, createdAt: event.original_occurred_at, completedAt, kind: "post_activity",
      });
    });
  }
  const teacherInvitations = invitationRows.filter((row) => scopeMatches(scope, row.assessorId, userId));
  const teacherHistory = await readSchoolQueryBatches<EffectiveEvent>(teacherInvitations.map((row) => row.id), (batch, offset, last) => effective("effective_lead_invitation_events")
    .select("*").in("invitation_id", batch).lt("original_occurred_at", end)
    .order("original_occurred_at", { ascending: true }).order("id", { ascending: true }).range(offset, last).returns<EffectiveEvent[]>());
  if (teacherHistory.error) throw new Error(teacherHistory.error.message);
  const historyByInvitation = new Map<string, EffectiveEvent[]>();
  for (const event of teacherHistory.data ?? []) {
    if (!event.invitation_id) continue;
    const history = historyByInvitation.get(event.invitation_id) ?? [];
    history.push(event); historyByInvitation.set(event.invitation_id, history);
  }
  for (const invitation of teacherInvitations) {
    const history = historyByInvitation.get(invitation.id) ?? [];
    let waitingSince: string | null = null;
    const addTeacherTask = (createdAt: string, completedAt: string | null) => {
      if (!completedAt || Date.parse(completedAt) >= Date.parse(start)) tasks.push({ key: `lead:${invitation.leadId}`, kind: "awaiting_teacher", dueAt: createdAt, createdAt, completedAt });
    };
    for (const event of history) {
      if (event.to_state === "awaiting_teacher") waitingSince ??= event.original_occurred_at;
      else if (waitingSince) { addTeacherTask(waitingSince, event.original_occurred_at); waitingSince = null; }
    }
    if (waitingSince) addTeacherTask(waitingSince, null);
    else if (history.length === 0 && invitation.state === "awaiting_teacher" && Date.parse(invitation.updatedAt) < Date.parse(end)) addTeacherTask(invitation.updatedAt, null);
  }
  return { date, events: scopedEvents.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id)), tasks };
}

export const communicationWorklistSchema = z.object({
  id: z.string(), name: z.string(), date: z.string(), ownerId: z.string(), createdBy: z.string(), createdAt: z.string(), closedAt: z.string().nullable(),
  items: z.array(z.object({ key: z.string(), position: z.number(), addedAt: z.string(), completedAt: z.string().nullable() })), rowKeys: z.array(z.string()),
});
export async function communicationWorkdayRpc(name: string, args: Record<string, unknown> = {}) {
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>).call(supabase, name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function getCommunicationWorklists(date?: string): Promise<CommunicationWorklist[]> {
  return z.array(communicationWorklistSchema).parse(await communicationWorkdayRpc("get_communication_worklists", { p_date: date ?? null }));
}
export async function getCommunicationWorklist(id: string): Promise<CommunicationWorklist> {
  return communicationWorklistSchema.parse(await communicationWorkdayRpc("get_communication_worklist", { p_id: id }));
}
