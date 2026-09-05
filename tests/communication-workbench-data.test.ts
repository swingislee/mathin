import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEnrollmentContext } from "../src/features/school/enrollment-workflow-contract";
import type { InvitationCoordinationRow } from "../src/features/school/invitation-contract";
import type { LeadPoolFilters } from "../src/features/school/lead-contract";
import { paginateCommunicationRows } from "../src/features/school/communication-workbench-contract";
import { communicationDayBounds, type CommunicationWorklist } from "../src/features/school/communication-workday-contract";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  posts: [] as ActivityEnrollmentContext[],
  requests: [] as { table: string; columns: string; ids: number[]; range?: [number, number]; search?: string }[],
  postReads: 0,
  contexts: [] as ActivityEnrollmentContext[],
  worklists: [] as CommunicationWorklist[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/features/school/enrollment-workflow-data", () => ({
  loadPostActivityFollowups: async () => { db.postReads++; return db.posts; },
  loadActivityEnrollmentContext: async ({ registrationId }: { registrationId: string }) => {
    const row = [...db.posts, ...db.contexts].find((entry) => entry.registrationId === registrationId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  },
}));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpcs.push({ name, args });
      return { data: name === "get_communication_worklist" ? db.worklists.find((row) => row.id === args.p_id) : db.worklists, error: null };
    },
    from: (table: string) => {
    const request = { table, columns: "", ids: [] as number[], range: undefined as [number, number] | undefined, search: undefined as string | undefined };
    db.requests.push(request);
    let rows = [...(db.tables[table] ?? db.tables[table.replace("effective_", "")] ?? [])];
    const orders: { key: string; ascending: boolean }[] = [];
    const result = () => {
      const sorted = [...rows].sort((a, b) => {
        for (const order of orders) {
          const diff = String(a[order.key] ?? "").localeCompare(String(b[order.key] ?? ""));
          if (diff) return order.ascending ? diff : -diff;
        }
        return 0;
      });
      const [start, end] = request.range ?? [0, 999];
      return { data: sorted.slice(start, Math.min(end + 1, start + 1000)), error: null, count: rows.length };
    };
    const query = {
      select: (columns: string) => { request.columns = columns; return query; },
      eq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return query; },
      neq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] !== value); return query; },
      gte: (key: string, value: string) => { rows = rows.filter((row) => Date.parse(String(row[key])) >= Date.parse(value)); return query; },
      lt: (key: string, value: string) => { rows = rows.filter((row) => Date.parse(String(row[key])) < Date.parse(value)); return query; },
      is: (key: string, value: unknown) => { rows = rows.filter((row) => (row[key] ?? null) === value); return query; },
      in: (key: string, values: string[]) => { request.ids.push(values.length); rows = rows.filter((row) => values.includes(row[key] as string)); return query; },
      not: (key: string, _operator: string, values: string) => { const excluded = values.slice(1, -1).split(","); rows = rows.filter((row) => !excluded.includes(row[key] as string)); return query; },
      or: (search: string) => {
        request.search = search;
        if (search.startsWith("completed_at.is.null,")) {
          const date = search.slice("completed_at.is.null,completed_at.gte.".length);
          rows = rows.filter((row) => row.completed_at == null || Date.parse(String(row.completed_at)) >= Date.parse(date));
          return query;
        }
        const word = search.split(".ilike.%")[1]?.split("%")[0] ?? "";
        rows = rows.filter((row) => [row.provisional_student_name, row.phone, row.phone_normalized].join(" ").includes(word));
        return query;
      },
      order: (key: string, options: { ascending: boolean }) => { orders.push({ key, ascending: options.ascending }); return query; },
      range: (start: number, end: number) => { request.range = [start, end]; return query; },
      limit: (size: number) => { request.range = [0, size - 1]; return query; },
      returns: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } }),
}));
import { loadCommunicationWorkbench } from "../src/features/school/communication-workbench-data";

const filters: LeadPoolFilters = { scope: "all", page: 1, pageSize: 20 };
const at = "2026-09-05T05:00:00Z";
const lead = (id: string, owner = "owner", studentId: string | null = null) => ({
  id, provisional_student_name: `Name ${id}`, phone: "13812345678", phone_normalized: "13812345678", grade_hint: 3,
  grade_text: "", status: "uncontacted", owner_id: owner, suggested_student_id: null, student_id: studentId, created_at: at,
});
const invitation = (id: string, leadId: string, state = "confirmed", updatedAt = at) => ({
  id, lead_id: leadId, kind: "assessment_1v1", state, activity_id: null, assessor_id: "teacher", proposed_time_text: "",
  parent_time_options: [], assessor_time_options: [], scheduled_at: at, location_text: "Room", summary: "", updated_at: updatedAt,
});
const invitationDto = (id: string, leadId: string, state: InvitationCoordinationRow["state"], updatedAt = at): InvitationCoordinationRow => ({
  id, leadId, leadName: leadId, phone: "13812345678", gradeText: "3", ownerName: "Owner", kind: "assessment_1v1", state,
  activityId: null, activityTitle: "", activityScheduledAt: null, assessorId: "teacher", assessorName: "Teacher",
  legacyTimeText: "", parentTimeOptions: [], assessorTimeOptions: [], scheduledAt: at, locationText: "", summary: "",
  updatedAt, nextContactAt: null, events: [],
});
const post = (registrationId: string, leadId: string | null = null, studentId: string | null = null): ActivityEnrollmentContext => ({
  registrationId, studentId, leadId, name: `Post ${registrationId}`, phone: "13912345678", grade: 3, gradeText: "", ownerId: "owner",
  leadStatus: null, activityId: "activity", activityTitle: "Workshop", activityAt: at, eligible: true, recommendation: "",
  assessmentBand: null, route: null, routeNote: "", enrollmentId: null, courseTitle: null, termName: null, classroomName: null,
  termId: null, canContact: true, canEnroll: true, contacts: [],
});
const contactEvent = (id: string, leadId: string, occurredAt = at, recordedBy = "owner") => ({
  id, lead_id: leadId, occurred_at: occurredAt, original_occurred_at: occurredAt, recorded_by: recordedBy,
  channel: "phone", outcome: "connected", note: `Note ${id}`, revision_id: null, revised_at: null, can_revise: true,
});
const nextAction = (id: string, leadId: string, dueAt = "2026-09-04T05:00:00Z", kind = "retry", completedAt: string | null = null) => ({
  id, lead_id: leadId, kind, due_at: dueAt, created_at: "2026-09-03T05:00:00Z", completed_at: completedAt, status: completedAt ? "completed" : "open",
});

describe("communication merged page", () => {
  beforeEach(() => { db.tables = {}; db.posts = []; db.requests = []; db.postReads = 0; db.worklists = []; db.contexts = []; db.rpcs = []; vi.restoreAllMocks(); });

  it("prefers the active invitation, keeps post registrations, and pages the union without duplicate leads", () => {
    const leadCandidates = Array.from({ length: 39 }, (_, i) => ({ id: `lead-${i}`, createdAt: at, studentId: null }));
    const invitations = [invitationDto("new-closed", "lead-0", "completed", "2026-09-06T05:00:00Z"), invitationDto("active", "lead-0", "confirmed")];
    const input = { leadCandidates, invitations, postActivityRows: [post("first"), post("second", "lead-0")], filters, userId: "owner", includeContacts: true };
    const pages = [1, 2, 3].map((page) => paginateCommunicationRows({ ...input, filters: { ...filters, page } }));
    expect(pages.map((page) => page.entries.length)).toEqual([20, 20, 1]);
    expect(pages.every((page) => page.count === 41)).toBe(true);
    const entries = pages.flatMap((page) => page.entries);
    expect(new Set(entries.map((row) => row.key)).size).toBe(41);
    expect(entries.filter((row) => row.source === "lead" && row.leadId === "lead-0")).toHaveLength(1);
    expect(entries.find((row) => row.source === "lead" && row.leadId === "lead-0")).toMatchObject({ invitation: { id: "active" } });
  });

  it("searches before pagination and retains the current invitation when historical notes match", () => {
    const old = { ...invitationDto("old", "lead", "cancelled"), summary: "matrix concern" };
    const result = paginateCommunicationRows({ leadCandidates: [{ id: "lead", createdAt: at, studentId: null }], matchingLeadIds: [],
      invitations: [old, invitationDto("active", "lead", "confirmed")], postActivityRows: [post("unrelated")],
      filters: { ...filters, q: "matrix", page: 9 }, userId: "owner", includeContacts: true });
    expect(result).toMatchObject({ count: 1, page: 1 });
    expect(result.entries[0]).toMatchObject({ invitation: { id: "active" } });
  });

  it("keeps the same default page position after first contact confirms an invitation or a post gets a new contact", () => {
    const leadCandidates = Array.from({ length: 35 }, (_, i) => ({ id: `lead-${String(i).padStart(2, "0")}`, createdAt: at, studentId: null }));
    const postActivityRows = Array.from({ length: 10 }, (_, i) => post(`registration-${i}`));
    const input = { leadCandidates, invitations: [] as InvitationCoordinationRow[], postActivityRows,
      filters, userId: "owner", includeContacts: true };
    const pageKeys = (state: typeof input) => [1, 2, 3].map((page) => paginateCommunicationRows({ ...state,
      filters: { ...filters, page } }).entries.map((row) => row.key));
    const before = pageKeys(input);
    expect(before[1]).toContain("lead:lead-25");
    expect(before[1]).toContain("post:registration-0");
    const after = pageKeys({ ...input,
      invitations: [invitationDto("new-confirmed", "lead-25", "confirmed", "2026-09-08T05:00:00Z")],
      postActivityRows: postActivityRows.map((row) => row.registrationId === "registration-0" ? { ...row,
        contacts: [{ id: "new-contact", channel: "phone", outcome: "connected", route: "continue_follow_up", note: "已联系",
          nextContactAt: null, occurredAt: "2026-09-09T05:00:00Z", recordedByName: "Owner" }] } : row),
    });
    expect(after).toEqual(before);
  });

  it("uses stable lead IDs for teacher-only rows without lead creation timestamps", () => {
    const invitations = Array.from({ length: 25 }, (_, i) => invitationDto(`invitation-${i}`, `lead-${String(i).padStart(2, "0")}`, "confirmed"));
    const input = { leadCandidates: [], invitations, postActivityRows: [], filters: { ...filters, page: 2 }, userId: "teacher", includeContacts: false };
    const before = paginateCommunicationRows(input).entries.map((row) => row.key);
    const after = paginateCommunicationRows({ ...input, invitations: invitations.map((row) => row.leadId === "lead-24"
      ? { ...row, updatedAt: "2026-09-10T05:00:00Z" } : row) }).entries.map((row) => row.key);
    expect(before).toContain("lead:lead-24");
    expect(after).toEqual(before);
  });

  it("reads beyond 500 invitations and 1000 lead candidates and only hydrates selected rows", async () => {
    db.tables.leads = Array.from({ length: 1051 }, (_, i) => lead(`lead-${String(i).padStart(4, "0")}`));
    db.tables.lead_invitation_threads = db.tables.leads.slice(0, 525).map((row, i) => invitation(`invite-${i}`, row.id as string));
    db.posts = [post("standalone")];
    const result = await loadCommunicationWorkbench("owner", { ...filters, pageSize: 100, page: 11 }, true);
    expect(result.count).toBe(1052);
    expect(result.contactLeads).toHaveLength(51);
    expect(result.postActivityRows).toHaveLength(1);
    expect(result.leadDetails).toHaveLength(51);
    expect(Math.max(...db.requests.flatMap((request) => request.ids))).toBeLessThanOrEqual(80);
    const hydrated = db.requests.filter((request) => request.table === "leads" && request.columns.includes("suggested_student_id"));
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0].range).toEqual([0, 50]);
    expect(db.requests.some((request) => request.table === "lead_invitation_threads" && request.range?.[0] === 400)).toBe(true);
  });

  it("keeps teacher access on assigned invitations without general contact hydration or post RPCs", async () => {
    db.tables.leads = [lead("assigned", "sales"), lead("other", "teacher")];
    db.tables.lead_invitation_threads = [invitation("assigned-invite", "assigned"), { ...invitation("other-invite", "other"), assessor_id: "other-teacher" }];
    const result = await loadCommunicationWorkbench("teacher", { ...filters, scope: "mine" }, false);
    expect(result.count).toBe(1);
    expect(result.invitations.map((row) => row.leadId)).toEqual(["assigned"]);
    expect(result.contactLeads).toEqual([]);
    expect(result.leadDetails).toEqual([]);
    expect(db.postReads).toBe(0);
    expect(db.requests.some((request) => request.columns === "id,created_at,student_id")).toBe(false);
  });

  it("returns the current page order and keeps older threads available without adding another primary row", async () => {
    db.tables.leads = [lead("one")];
    db.tables.lead_invitation_threads = [invitation("active", "one"), invitation("history", "one", "completed", "2026-09-06T05:00:00Z")];
    const result = await loadCommunicationWorkbench("owner", filters, true);
    expect(result.count).toBe(1);
    expect(result.rowOrder).toEqual(["lead:one"]);
    expect(result.invitations.map((row) => row.id)).toEqual(["active"]);
    expect(result.invitationHistory.map((row) => row.id)).toEqual(["history"]);
    expect(result.contactLeads).toEqual([]);
    expect(result.leadDetails.map((row) => row.id)).toEqual(["one"]);
  });

  it("focuses one RLS-visible lead and its converted-student posts while clearing old filters", async () => {
    db.tables.leads = [lead("focus", "other-owner", "student"), lead("other")];
    db.posts = [post("linked", null, "student"), post("unrelated"), post("direct", "focus")];
    const result = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine", status: "invalid", q: "missing", page: 8 }, true, "focus");
    expect(result).toMatchObject({ count: 3, page: 1 });
    expect(result.contactLeads.map((row) => row.id)).toEqual(["focus"]);
    expect(result.postActivityRows.map((row) => row.registrationId).sort()).toEqual(["direct", "linked"]);
    expect(db.requests.some((request) => request.search)).toBe(false);
  });

  it("applies server-side lead name and phone search before counting and hydrating", async () => {
    db.tables.leads = [lead("target"), lead("unrelated")];
    const result = await loadCommunicationWorkbench("owner", { ...filters, q: "target" }, true);
    expect(result.count).toBe(1);
    expect(result.contactLeads.map((row) => row.id)).toEqual(["target"]);
    expect(db.requests.some((request) => request.search?.includes("provisional_student_name.ilike.%target%"))).toBe(true);
  });

  it("uses Shanghai day boundaries and rejects nonexistent calendar dates", () => {
    expect(communicationDayBounds("2026-09-05")).toEqual({ start: "2026-09-04T16:00:00.000Z", end: "2026-09-05T16:00:00.000Z" });
    expect(() => communicationDayBounds("2026-02-30")).toThrow("INVALID_COMMUNICATION_DATE");
  });

  it("unions my actual records with current-owner due tasks while retaining completed-today work and excluding initial assignments", async () => {
    db.tables.leads = [lead("recorded", "other-owner"), lead("due"), lead("done-today"), lead("old-done"), lead("initial"), lead("future"), lead("other-task", "other-owner"), lead("other-record")];
    db.tables.effective_lead_communications = [contactEvent("mine", "recorded"), contactEvent("other", "other-record", at, "other-owner")];
    db.tables.lead_next_actions = [nextAction("due", "due"), nextAction("done", "done-today", undefined, "retry", at),
      nextAction("old", "old-done", undefined, "retry", "2026-09-04T15:59:59Z"), nextAction("initial", "initial", undefined, "initial_contact"),
      nextAction("future", "future", "2026-09-06T05:00:00Z"), nextAction("other", "other-task"),
      { ...nextAction("cancelled", "old-done"), status: "cancelled" }];
    const result = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine", status: "invalid" }, true, undefined, { view: "day", date: "2026-09-05" });
    expect(result.rowOrder).toEqual(["lead:done-today", "lead:due", "lead:recorded"]);
    expect(result.contactLeads.map((row) => row.id).sort()).toEqual(["done-today", "due", "recorded"]);
    expect(result.workday?.events.map((row) => row.id)).toEqual(["mine"]);
    expect(result.workday?.tasks.map((row) => row.key).sort()).toEqual(["lead:done-today", "lead:due"]);
    expect(db.rpcs.find((row) => row.name === "get_communication_worklists")?.args).toEqual({ p_date: null });
  });

  it("reads every effective daily event before pagination and uses the corrected occurrence date", async () => {
    db.tables.leads = Array.from({ length: 25 }, (_, i) => lead(`lead-${i}`));
    db.tables.effective_lead_communications = Array.from({ length: 1051 }, (_, i) => contactEvent(`event-${i}`, `lead-${i % 25}`));
    db.tables.effective_lead_communications.push({ ...contactEvent("corrected", "lead-0", "2026-09-04T16:00:00.000Z"),
      original_occurred_at: "2026-09-01T05:00:00Z", revision_id: "revision", revised_at: at, note: "Corrected note" },
    contactEvent("tomorrow", "lead-0", "2026-09-05T16:00:00.000Z"));
    const result = await loadCommunicationWorkbench("owner", filters, true, undefined, { view: "records", date: "2026-09-05" });
    expect(result.count).toBe(25);
    expect(result.rowOrder).toHaveLength(20);
    expect(result.workday?.events).toHaveLength(1052);
    expect(result.workday?.events[0]).toMatchObject({ id: "corrected", recordedAt: "2026-09-01T05:00:00Z", revisionId: "revision", note: "Corrected note", canRevise: true });
    expect(db.requests.some((row) => row.table === "effective_lead_communications" && row.range?.[0] === 1000)).toBe(true);
  });

  it("keeps the latest recorded contact as current facts when an older event is corrected to a later occurrence date", async () => {
    db.tables.leads = [lead("one")];
    db.tables.effective_lead_communications = [
      { ...contactEvent("old", "one", "2026-09-07T05:00:00Z"), original_occurred_at: "2026-09-03T05:00:00Z", outcome: "unreachable", note: "Old corrected" },
      { ...contactEvent("latest", "one", at), outcome: "connected", note: "Current latest" },
    ];
    const result = await loadCommunicationWorkbench("owner", filters, true);
    expect(result.contactLeads[0]).toMatchObject({ lastContactOutcome: "connected", lastContactNote: "Current latest", contactCount: 2 });
  });

  it("includes invitation records and closed post records in records view even after current eligibility changes", async () => {
    db.tables.leads = [lead("invited")];
    db.tables.lead_invitation_threads = [invitation("invitation", "invited")];
    db.tables.effective_lead_invitation_events = [{ ...contactEvent("inv-event", "ignored"), invitation_id: "invitation", to_state: "confirmed" }];
    db.tables.effective_activity_followup_contacts = [{ ...contactEvent("post-event", "ignored"), registration_id: "closed", route: "closed" }];
    db.contexts = [{ ...post("closed"), eligible: false, canContact: false, ownerId: "another", enrollmentId: "enrollment" }];
    const result = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine" }, true, undefined, { view: "records", date: "2026-09-05" });
    expect(result.rowOrder).toEqual(["lead:invited", "post:closed"]);
    expect(result.postActivityRows[0]).toMatchObject({ registrationId: "closed", eligible: false, canContact: false });
    expect(result.workday?.events.map((row) => row.source).sort()).toEqual(["invitation", "post_activity"]);
  });

  it("uses the post reminder that was pending during the selected day, even if a later contact cleared it", async () => {
    db.posts = [{ ...post("post"), route: "closed" }];
    db.tables.effective_activity_followup_contacts = [
      { ...contactEvent("previous", "ignored", "2026-09-03T05:00:00Z", "another"), registration_id: "post", route: "continue_follow_up", next_contact_at: "2026-09-04T05:00:00Z" },
      { ...contactEvent("cleared", "ignored", at, "another"), registration_id: "post", route: "closed", next_contact_at: null },
    ];
    const today = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine" }, true, undefined, { view: "day", date: "2026-09-05" });
    expect(today.rowOrder).toEqual(["post:post"]);
    expect(today.workday?.events).toEqual([]);
    expect(today.workday?.tasks).toEqual([{ key: "post:post", dueAt: "2026-09-04T05:00:00Z", createdAt: "2026-09-03T05:00:00Z", completedAt: at, kind: "post_activity" }]);
    const yesterday = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine" }, true, undefined, { view: "day", date: "2026-09-04" });
    expect(yesterday.rowOrder).toEqual(["post:post"]);
    const tomorrow = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine" }, true, undefined, { view: "day", date: "2026-09-06" });
    expect(tomorrow.rowOrder).toEqual([]);
  });

  it("ends an outstanding post reminder at the actual enrollment confirmation and keeps the completion day", async () => {
    db.posts = [{ ...post("post"), enrollmentId: "enrollment" }];
    db.tables.course_enrollments = [{ id: "enrollment", confirmed_at: at }];
    db.tables.effective_activity_followup_contacts = [{ ...contactEvent("previous", "ignored", "2026-09-03T05:00:00Z"), registration_id: "post", route: "continue_follow_up", next_contact_at: "2026-09-04T05:00:00Z" }];
    const today = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine" }, true, undefined, { view: "day", date: "2026-09-05" });
    expect(today.rowOrder).toEqual(["post:post"]);
    expect(today.workday?.tasks[0]).toMatchObject({ key: "post:post", completedAt: at });
    const tomorrow = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine" }, true, undefined, { view: "day", date: "2026-09-06" });
    expect(tomorrow.rowOrder).toEqual([]);
    expect(tomorrow.workday?.tasks).toEqual([]);
  });

  it("does not invent an enrollment completion time when RLS only exposes its existence", async () => {
    db.posts = [{ ...post("post"), enrollmentId: "hidden-enrollment" }];
    db.tables.effective_activity_followup_contacts = [{ ...contactEvent("today", "ignored"), registration_id: "post", route: "continue_follow_up", next_contact_at: "2026-09-04T05:00:00Z" }];
    const result = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine" }, true, undefined, { view: "day", date: "2026-09-05" });
    expect(result.workday?.tasks).toEqual([]);
    expect(result.workday?.events).toHaveLength(1);
    expect(result.rowOrder).toEqual(["post:post"]);
  });

  it("keeps first contacts and unreachable leads without future reminders in unscheduled, excluding future appointments and finished posts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(at));
    db.tables.leads = [lead("first"), lead("unreachable"), lead("reminder"), lead("scheduled"), { ...lead("invalid"), status: "invalid" }, { ...lead("converted"), status: "converted" }];
    db.tables.lead_next_actions = [nextAction("initial", "first", undefined, "initial_contact"), nextAction("reminder", "reminder", "2026-09-06T05:00:00Z")];
    db.tables.lead_invitation_threads = [{ ...invitation("scheduled", "scheduled"), scheduled_at: "2026-09-06T05:00:00Z" }];
    db.posts = [post("pending"), { ...post("closed"), route: "closed" }, { ...post("enrolled"), enrollmentId: "enrolled" }];
    const result = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine" }, true, undefined, { view: "unscheduled", date: "2026-09-05" });
    expect(result.rowOrder).toEqual(["lead:first", "lead:unreachable", "post:pending"]);
    expect(result.workday?.tasks).toEqual([]);
  });

  it("retains a fixed worklist order and completed records across dates and current status filters", async () => {
    db.tables.leads = [{ ...lead("finished", "another"), status: "invalid" }, lead("first")];
    db.posts = [{ ...post("finished"), eligible: false, canContact: false }];
    db.worklists = [{ id: "worklist", name: "Friday calls", date: "2026-09-04", ownerId: "owner", createdBy: "owner", createdAt: at, closedAt: null,
      items: [{ key: "post:finished", position: 1, addedAt: at, completedAt: at }, { key: "lead:finished", position: 2, addedAt: at, completedAt: at }, { key: "lead:first", position: 3, addedAt: at, completedAt: null }],
      rowKeys: ["post:finished", "lead:finished", "lead:first"] }];
    const result = await loadCommunicationWorkbench("owner", { ...filters, scope: "mine", status: "contacted" }, true, undefined, { view: "worklist", date: "2026-09-05", worklistId: "worklist" });
    expect(result.rowOrder).toEqual(["post:finished", "lead:finished", "lead:first"]);
    expect(result.worklist?.date).toBe("2026-09-04");
    expect(result.worklists).toHaveLength(1);
    expect(result.contactLeads).toHaveLength(2);
  });

  it("gives a review-only teacher assigned confirmation tasks and retains a task on its completion day", async () => {
    db.tables.leads = [lead("waiting", "sales"), lead("done", "sales"), lead("old", "sales"), lead("other", "sales")];
    db.tables.lead_invitation_threads = [invitation("waiting", "waiting", "awaiting_teacher", "2026-09-04T05:00:00Z"),
      invitation("done", "done"), invitation("old", "old"), { ...invitation("other", "other", "awaiting_teacher"), assessor_id: "someone-else" }];
    db.tables.effective_lead_invitation_events = [
      { ...contactEvent("entered", "ignored", "2026-09-04T05:00:00Z", "sales"), invitation_id: "done", to_state: "awaiting_teacher" },
      { ...contactEvent("left", "ignored", at, "sales"), invitation_id: "done", to_state: "confirmed" },
      { ...contactEvent("old-entered", "ignored", "2026-09-02T05:00:00Z", "sales"), invitation_id: "old", to_state: "awaiting_teacher" },
      { ...contactEvent("old-left", "ignored", "2026-09-03T05:00:00Z", "sales"), invitation_id: "old", to_state: "confirmed" },
    ];
    const result = await loadCommunicationWorkbench("teacher", { ...filters, scope: "mine" }, false, undefined, { view: "day", date: "2026-09-05" });
    expect(result.rowOrder).toEqual(["lead:done", "lead:waiting"]);
    expect(result.workday?.events).toEqual([]);
    expect(result.workday?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "lead:done", kind: "awaiting_teacher", completedAt: at }),
      expect.objectContaining({ key: "lead:waiting", kind: "awaiting_teacher", completedAt: null }),
    ]));
    expect(result.worklists).toEqual([]);
    expect(db.rpcs).toEqual([]);
    expect(db.postReads).toBe(0);
  });
});
