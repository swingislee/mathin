import type { ActivityEnrollmentContext } from "./enrollment-workflow-contract";
import type { InvitationCoordinationRow } from "./invitation-contract";
import type { LeadPoolFilters } from "./lead-contract";

export interface CommunicationLeadCandidate {
  id: string;
  createdAt: string;
  studentId: string | null;
  status?: string;
}

export type CommunicationPageEntry =
  | { key: string; source: "lead"; leadId: string; invitation: InvitationCoordinationRow | null; timestamp: number }
  | { key: string; source: "post_activity"; row: ActivityEnrollmentContext; timestamp: number };

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function isActive(row: InvitationCoordinationRow): boolean {
  return row.state !== "completed" && row.state !== "cancelled";
}

function matchesSearch(query: string | undefined, values: string[], phone: string): boolean {
  if (!query) return true;
  if (values.join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase())) return true;
  const digits = query.replace(/\D/g, "");
  return digits.length >= 3 && phone.replace(/\D/g, "").includes(digits);
}

/** 每条线索只保留一个主行，活动报名分别保留各自的后续沟通事项。 */
export function paginateCommunicationRows({
  leadCandidates, matchingLeadIds, invitations, postActivityRows, filters, userId,
  includeContacts, focusLeadId, selectedKeys, matchingEventKeys,
}: {
  leadCandidates: CommunicationLeadCandidate[];
  matchingLeadIds?: readonly string[];
  invitations: InvitationCoordinationRow[];
  postActivityRows: ActivityEnrollmentContext[];
  filters: LeadPoolFilters;
  userId: string;
  includeContacts: boolean;
  focusLeadId?: string;
  /** 已按日志作者/任务负责人及 RLS 求出的日集合，或持久工作单顺序。 */
  selectedKeys?: readonly string[];
  matchingEventKeys?: readonly string[];
}) {
  const effectiveFilters = focusLeadId
    ? { ...filters, scope: "all" as const, status: undefined, q: undefined, page: 1 }
    : filters;
  const candidates = new Map(leadCandidates.map((row) => [row.id, row]));
  const matching = new Set(matchingLeadIds ?? leadCandidates.map((row) => row.id));
  const selected = selectedKeys ? new Set(selectedKeys) : null;
  const eventMatches = new Set(matchingEventKeys ?? []);
  const chosenInvitations = new Map<string, InvitationCoordinationRow>();
  const matchingInvitationLeads = new Set<string>();
  for (const row of invitations) {
    if (focusLeadId && row.leadId !== focusLeadId) continue;
    if (includeContacts && !candidates.has(row.leadId)) continue;
    if (!includeContacts && !candidates.has(row.leadId)) {
      candidates.set(row.leadId, { id: row.leadId, createdAt: "", studentId: null });
    }
    if (matchesSearch(effectiveFilters.q, [row.leadName, row.phone, row.activityTitle, row.summary], row.phone)) {
      matchingInvitationLeads.add(row.leadId);
    }
    const previous = chosenInvitations.get(row.leadId);
    if (!previous || (isActive(row) && !isActive(previous))
      || (isActive(row) === isActive(previous) && (timestamp(row.updatedAt) > timestamp(previous.updatedAt)
        || (row.updatedAt === previous.updatedAt && row.id.localeCompare(previous.id) < 0)))) {
      chosenInvitations.set(row.leadId, row);
    }
  }

  const entries: CommunicationPageEntry[] = [];
  for (const candidate of candidates.values()) {
    if (focusLeadId && candidate.id !== focusLeadId) continue;
    if (selected && !selected.has(`lead:${candidate.id}`)) continue;
    const invitation = chosenInvitations.get(candidate.id) ?? null;
    if (!includeContacts && !invitation) continue;
    if (effectiveFilters.q && !matching.has(candidate.id) && !matchingInvitationLeads.has(candidate.id) && !eventMatches.has(`lead:${candidate.id}`)) continue;
    entries.push({
      key: `lead:${candidate.id}`, source: "lead", leadId: candidate.id, invitation,
      timestamp: timestamp(candidate.createdAt),
    });
  }

  const focusStudentId = focusLeadId ? candidates.get(focusLeadId)?.studentId : null;
  const seenRegistrations = new Set<string>();
  for (const row of postActivityRows) {
    const key = `post:${row.registrationId}`;
    if (seenRegistrations.has(row.registrationId) || (selected ? !selected.has(key) : !row.eligible)) continue;
    if (focusLeadId && row.leadId !== focusLeadId && (!focusStudentId || row.studentId !== focusStudentId)) continue;
    if (!selected && effectiveFilters.scope === "mine" && row.ownerId !== userId) continue;
    if (!selected && effectiveFilters.scope === "unassigned" && row.ownerId !== null) continue;
    if (!selected && effectiveFilters.status && row.leadStatus !== effectiveFilters.status) continue;
    if (!eventMatches.has(key) && !matchesSearch(effectiveFilters.q,
      [row.name, row.phone, row.activityTitle, row.recommendation, row.routeNote, ...row.contacts.map((contact) => contact.note)], row.phone)) continue;
    seenRegistrations.add(row.registrationId);
    entries.push({ key: `post:${row.registrationId}`, source: "post_activity", row,
      timestamp: timestamp(row.activityAt) });
  }
  // 默认页序锚定来源时间；保存沟通或邀约只更新事实，保持连续录入的位置。
  const positions = new Map(selectedKeys?.map((key, index) => [key, index]));
  entries.sort((a, b) => selected
    ? (positions.get(a.key) ?? 0) - (positions.get(b.key) ?? 0)
    : b.timestamp - a.timestamp || a.key.localeCompare(b.key));
  const count = entries.length;
  const totalPages = Math.max(1, Math.ceil(count / effectiveFilters.pageSize));
  const requestedPage = Number.isFinite(effectiveFilters.page) ? Math.floor(effectiveFilters.page) : 1;
  const page = Math.min(totalPages, Math.max(1, requestedPage));
  const offset = (page - 1) * effectiveFilters.pageSize;
  return { entries: entries.slice(offset, offset + effectiveFilters.pageSize), count, page, pageSize: effectiveFilters.pageSize };
}
