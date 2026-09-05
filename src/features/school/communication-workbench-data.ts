import "server-only";

import { createClient } from "@/lib/supabase/server";
import { loadActivityEnrollmentContext, loadPostActivityFollowups } from "./enrollment-workflow-data";
import { listInvitationCoordination } from "./invitations";
import { leadSearchFilter, listLeadPool } from "./leads";
import type { LeadPoolFilters, LeadPoolRow } from "./lead-contract";
import { paginateCommunicationRows, type CommunicationLeadCandidate } from "./communication-workbench-contract";
import { readSchoolQueryPages, SCHOOL_QUERY_ID_BATCH_SIZE } from "./school-query-pages";
import { communicationWorkdayKeys, type CommunicationWorkbenchOptions } from "./communication-workday-contract";
import { getCommunicationWorklist, getCommunicationWorklists, loadCommunicationWorkday } from "./communication-workday-data";
import type { ActivityEnrollmentContext } from "./enrollment-workflow-contract";
import type { InvitationCoordinationRow } from "./invitation-contract";

async function listCommunicationLeadCandidates(userId: string, filters: LeadPoolFilters, focusLeadId?: string) {
  const supabase = await createClient();
  const readCandidates = (query?: string) => readSchoolQueryPages((start, end) => {
    let request = supabase.from("leads").select("id,created_at,student_id,status");
    if (focusLeadId) request = request.eq("id", focusLeadId);
    if (filters.scope === "mine") request = request.eq("owner_id", userId);
    if (filters.scope === "unassigned") request = request.is("owner_id", null);
    if (filters.status) request = request.eq("status", filters.status);
    if (query) request = request.or(leadSearchFilter(query));
    return request.order("created_at", { ascending: false }).order("id", { ascending: true }).range(start, end);
  });
  const [all, matched] = await Promise.all([readCandidates(), filters.q ? readCandidates(filters.q) : Promise.resolve(null)]);
  if (all.error) throw new Error(all.error.message);
  if (matched?.error) throw new Error(matched.error.message);
  return {
    candidates: (all.data ?? []).map((row): CommunicationLeadCandidate => ({ id: row.id, createdAt: row.created_at, studentId: row.student_id, status: row.status })),
    matchingLeadIds: matched?.data?.map((row) => row.id),
  };
}

async function unscheduledKeys(candidates: CommunicationLeadCandidate[], invitations: InvitationCoordinationRow[], posts: ActivityEnrollmentContext[], userId: string, filters: LeadPoolFilters) {
  const supabase = await createClient();
  const now = Date.now();
  const reminders = await readSchoolQueryPages((start, end) => supabase.from("lead_next_actions")
    .select("lead_id,due_at").eq("status", "open").neq("kind", "initial_contact")
    .gte("due_at", new Date(now).toISOString()).order("id", { ascending: true }).range(start, end));
  if (reminders.error) throw new Error(reminders.error.message);
  const arranged = new Set((reminders.data ?? []).map((row) => row.lead_id));
  for (const invitation of invitations) {
    if (invitation.state !== "completed" && invitation.state !== "cancelled"
      && Date.parse(invitation.scheduledAt ?? invitation.activityScheduledAt ?? "") >= now) arranged.add(invitation.leadId);
  }
  const leadKeys = candidates.filter((row) => row.status !== "invalid" && row.status !== "converted" && !arranged.has(row.id)).map((row) => `lead:${row.id}`);
  const postKeys = posts.filter((row) => row.eligible && !row.enrollmentId && row.route !== "closed"
    && (filters.scope === "all" || (filters.scope === "mine" ? row.ownerId === userId : row.ownerId === null))
    && (!row.contacts[0]?.nextContactAt || Date.parse(row.contacts[0].nextContactAt) < now)).map((row) => `post:${row.registrationId}`);
  return [...leadKeys, ...postKeys];
}

async function includeRequiredPosts(rows: ActivityEnrollmentContext[], keys: readonly string[]) {
  const existing = new Set(rows.map((row) => row.registrationId));
  const missing = [...new Set(keys.filter((key) => key.startsWith("post:")).map((key) => key.slice(5)))].filter((id) => !existing.has(id));
  const contexts = [...rows];
  // 工作单可能保留已完成报名；逐批读当前可见上下文，权限仍由原 RPC 校验。
  for (let offset = 0; offset < missing.length; offset += 8) {
    const batch = await Promise.all(missing.slice(offset, offset + 8).map(async (registrationId) => {
      try { return await loadActivityEnrollmentContext({ registrationId, invitationId: null }); }
      catch (error) {
        if (error instanceof Error && /FORBIDDEN|NOT_FOUND/.test(error.message)) return null;
        throw error;
      }
    }));
    contexts.push(...batch.filter((row): row is ActivityEnrollmentContext => row !== null));
  }
  return contexts;
}

export async function loadCommunicationWorkbench(
  userId: string,
  filters: LeadPoolFilters,
  canViewLeads: boolean,
  focusLeadId?: string,
  options?: CommunicationWorkbenchOptions,
) {
  const selectedView = !focusLeadId && options && ["day", "records", "worklist"].includes(options.view);
  const effectiveFilters: LeadPoolFilters = focusLeadId
    ? { ...filters, scope: "all", status: undefined, q: undefined, page: 1 }
    : selectedView ? { ...filters, scope: "all", status: undefined } : filters;
  const [leadResult, invitations, initialPostRows, worklists, worklist] = await Promise.all([
    canViewLeads ? listCommunicationLeadCandidates(userId, effectiveFilters, focusLeadId)
      : Promise.resolve({ candidates: [], matchingLeadIds: undefined }),
    listInvitationCoordination({ queue: "all", stage: "all" }, {
      ...(focusLeadId ? { leadIds: [focusLeadId] } : {}),
      ...(!canViewLeads ? { assessorId: userId } : {}),
    }),
    canViewLeads ? loadPostActivityFollowups() : Promise.resolve([]),
    options && canViewLeads ? getCommunicationWorklists() : Promise.resolve([]),
    options?.view === "worklist" && options.worklistId && canViewLeads ? getCommunicationWorklist(options.worklistId) : Promise.resolve(null),
  ]);
  const workday = options ? await loadCommunicationWorkday(userId, filters.scope, options.date, initialPostRows, canViewLeads, invitations) : undefined;
  let selectedKeys: string[] | undefined;
  if (!focusLeadId && options) {
    if (options.view === "day" && workday) selectedKeys = communicationWorkdayKeys(workday);
    if (options.view === "records" && workday) selectedKeys = communicationWorkdayKeys({ ...workday, tasks: [] });
    if (options.view === "worklist") selectedKeys = worklist?.items.slice().sort((a, b) => a.position - b.position).map((row) => row.key) ?? [];
    if (options.view === "unscheduled") selectedKeys = canViewLeads
      ? await unscheduledKeys(leadResult.candidates, invitations, initialPostRows, userId, filters) : [];
  }
  const postActivityRows = selectedKeys && canViewLeads ? await includeRequiredPosts(initialPostRows, selectedKeys) : initialPostRows;
  const matchingEventKeys = effectiveFilters.q && workday ? workday.events.filter((event) =>
    [event.note, event.recordedByName, event.details ?? ""].join(" ").toLocaleLowerCase().includes(effectiveFilters.q!.toLocaleLowerCase())).map((event) => event.key) : undefined;
  const selection = paginateCommunicationRows({
    leadCandidates: leadResult.candidates, matchingLeadIds: leadResult.matchingLeadIds,
    invitations, postActivityRows, filters: effectiveFilters, userId, includeContacts: canViewLeads, focusLeadId, selectedKeys, matchingEventKeys,
  });
  const selectedLeadIds = selection.entries.flatMap((row) => row.source === "lead" ? [row.leadId] : []);
  const leadDetails: LeadPoolRow[] = [];
  if (canViewLeads) {
    for (let index = 0; index < selectedLeadIds.length; index += SCHOOL_QUERY_ID_BATCH_SIZE) {
      const batch = selectedLeadIds.slice(index, index + SCHOOL_QUERY_ID_BATCH_SIZE);
      const result = await listLeadPool(userId, { ...effectiveFilters, q: undefined, page: 1 }, batch);
      leadDetails.push(...result.leads);
    }
  }
  const contactIds = new Set(selection.entries.flatMap((row) => row.source === "lead" && !row.invitation ? [row.leadId] : []));
  const selectedLeadIdSet = new Set(selectedLeadIds);
  const selectedInvitationIds = new Set(selection.entries.flatMap((row) => row.source === "lead" && row.invitation ? [row.invitation.id] : []));
  return {
    contactLeads: leadDetails.filter((row) => contactIds.has(row.id)),
    leadDetails,
    invitations: selection.entries.flatMap((row) => row.source === "lead" && row.invitation ? [row.invitation] : []),
    invitationHistory: invitations.filter((row) => selectedLeadIdSet.has(row.leadId) && !selectedInvitationIds.has(row.id)),
    postActivityRows: selection.entries.flatMap((row) => row.source === "post_activity" ? [row.row] : []),
    rowOrder: selection.entries.map((row) => row.key),
    count: selection.count, page: selection.page, pageSize: selection.pageSize,
    workday, worklist, worklists,
  };
}
