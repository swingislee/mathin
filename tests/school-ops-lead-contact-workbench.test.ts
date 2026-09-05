import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { updateLeadSelection } from "@/features/school/lead-selection";
import {
  filterAndSortLeadRows,
  NO_ACQUISITION_LOCATION_FILTER,
  NO_ACQUISITION_TIME_FILTER,
  NO_CONTACT_FILTER,
  NO_OWNER_FILTER,
} from "@/features/school/lead-table-view";
import { leadPaginationTokens } from "@/features/school/lead-pagination";
import {
  deriveLeadContactDestination,
  parseLeadPageSize,
  type LeadPoolRow,
} from "@/features/school/lead-contract";
import {
  applyDirectAssessmentTime,
  assessmentAvailabilityIntersection,
  assessmentTimeOptionForInstant,
  assessmentTimeOptionToInstant,
  defaultInvitationState,
  invitationCanHaveNextContactReminder,
  invitationCoordinationStageFrom,
  invitationDraftIsComplete,
  invitationQueueFrom,
  invitationStateFromFacts,
  selectInvitationProgress,
  invitationStatesForKind,
  invitationWorkStep,
} from "@/features/school/invitation-contract";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("SCHOOL-OPS lead assignment and first-contact workbench", () => {
  it("stores repeatable communication and next-action facts instead of copied calendar columns", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260902001300_school_ops_lead_contact_workbench.sql",
    );

    expect(migration).toContain("create table public.lead_communications");
    expect(migration).toContain("create table public.lead_next_actions");
    expect(migration).toContain("occurred_at timestamptz not null default now()");
    expect(migration).toContain("recorded_by uuid not null references public.profiles");
    expect(migration).toContain("create unique index lead_next_actions_one_open_idx");
    for (const copiedSpreadsheetColumn of [
      "confirmation_month",
      "confirmation_week",
      "followup_month",
      "followup_week",
      "confirmation_person_name",
    ]) {
      expect(migration).not.toContain(copiedSpreadsheetColumn);
    }
  });

  it("keeps assignment independent from contact stage while creating the first-call queue atomically", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260903000400_school_ops_lead_pool_semantics.sql",
    );
    const assignment = migration.slice(
      migration.indexOf("create or replace function public.assign_leads"),
      migration.indexOf("revoke all on function public.normalize_legacy_lead_status"),
    );

    expect(assignment).toContain("cardinality(p_lead_ids) not between 1 and 100");
    expect(assignment).toContain("public.has_perm(v_uid, 'student.assign')");
    expect(assignment).toContain("public.has_perm(p_staff_user_id, 'followup.write')");
    expect(assignment).toContain("set owner_id = p_staff_user_id");
    expect(assignment).not.toContain("set owner_id = p_staff_user_id,");
    expect(assignment).toContain("'initial_contact', now(), v_uid");
    expect(assignment).toContain("LEAD_SCOPE_MISMATCH");
    expect(migration).toContain("set status = 'uncontacted'");
    expect(migration).toContain("if new.status = 'unassigned' then");
    expect(migration).toContain("alter column status set default 'uncontacted'");
    expect(migration).not.toContain("check (status in ('unassigned'");
  });

  it("derives pool status and next-action kind from a short call form", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260902001300_school_ops_lead_contact_workbench.sql",
    );
    const contact = migration.slice(migration.indexOf("create or replace function public.record_lead_contact"));

    expect(contact).toContain("when p_visit_committed is true then 'intent_confirmed'");
    expect(contact).toContain("when p_outcome = 'declined' then 'nurture'");
    expect(contact).toContain("when p_outcome = 'unreachable' then 'retry'");
    expect(contact).toContain("when p_wechat_added is true then 'wechat_followup'");
    expect(contact).toContain("when p_visit_committed is true then 'visit_confirmation'");
    expect(contact).toContain("update public.lead_next_actions");
    expect(contact).toContain("insert into public.lead_communications");
  });

  it("moves invitation coordination out of contact status and keeps structured two-sided availability", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260903001100_school_ops_invitation_coordination.sql",
    );
    const page = read("src", "app", "[locale]", "dashboard", "followups", "communication", "page.tsx");
    const workbench = read("src", "features", "school", "InvitationCoordinationWorkbench.tsx");
    const draftFields = read("src", "features", "school", "InvitationDraftFields.tsx");
    const availabilityGrid = read("src", "features", "school", "AssessmentAvailabilityGrid.tsx");
    const availabilityMigration = read(
      "supabase",
      "migrations",
      "20260903001500_school_ops_invitation_availability_grid.sql",
    );
    const reminderMigration = read(
      "supabase",
      "migrations",
      "20260904000420_school_ops_optional_contact_reminders.sql",
    );

    expect(migration).toContain("create table public.lead_invitation_threads");
    expect(migration).toContain("create table public.lead_invitation_events");
    expect(migration).toContain("proposed_time_text text not null default ''");
    expect(migration).toContain("lead_invitation_threads_one_active_idx");
    expect(migration).toContain("alter table public.lead_invitation_threads enable row level security");
    expect(migration).toContain("create or replace function public.record_lead_contact_v2");
    expect(migration).toContain("create or replace function public.update_lead_invitation");
    expect(migration).toContain("if v_invitation.state in ('completed','cancelled') then raise exception 'INVITATION_CLOSED'; end if;");
    expect(migration).toContain("p_invitation_state");
    expect(migration).not.toContain("p_next_action_at");
    expect(availabilityMigration).toContain("parent_time_options text[]");
    expect(availabilityMigration).toContain("assessor_time_options text[]");
    expect(availabilityMigration).toContain("create or replace function public.record_lead_contact_v3");
    expect(availabilityMigration).toContain("create or replace function public.set_invitation_assessor_availability");
    expect(availabilityMigration).toContain("after_school");
    expect(reminderMigration).toContain("create or replace function public.set_lead_contact_reminder");
    expect(reminderMigration).toContain("create or replace function public.record_lead_contact_v4");
    expect(reminderMigration).toContain("create or replace function public.update_lead_invitation_v3");
    expect(reminderMigration).toContain("'invitation_followup'");
    expect(reminderMigration).toContain("p_remind_at is not null and p_remind_at <= now()");
    expect(reminderMigration).toContain("lead_invitation_threads_close_reminder");
    expect(page).toContain("InvitationCoordinationWorkbench");
    expect(page).toContain("FollowupTabs");
    expect(page).toContain("loadCommunicationWorkbench");
    expect(page).toContain("contactLeads={data.contactLeads}");
    expect(page).not.toContain("COORDINATION_STAGES");
    expect(workbench).toContain("copyWithFallback");
    expect(workbench).toContain("copyRelay");
    expect(workbench).toContain("sticky left-0 top-0");
    expect(workbench).toContain("DashboardTableColumnHeader");
    expect(workbench).toContain("school.followup.communication");
    expect(workbench).toContain("InvitationQuickContact");
    expect(workbench).toContain('t("workHint_waiting_assessor_response", { assessor:');
    expect(workbench).not.toContain('row.state === "confirmed" && !dirty');
    expect(workbench).toContain("onConfirmedReady");
    expect(workbench).toContain("confirmedDraftComplete");
    expect(workbench).toContain("postActivityRows");
    expect(workbench).toContain("FollowupInlineDetails");
    expect(workbench).not.toContain("FollowupDetails");
    expect(workbench).toContain("colSpan={4}");
    expect(workbench).toContain("const rowWorkStep =");
    expect(workbench).toContain("const rowActionHint =");
    expect(workbench).toContain("@[56rem]/invitation-editor:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]");
    expect(draftFields).toContain("INVITATION_KINDS.map");
    expect(draftFields).toContain("FollowupChoice");
    expect(draftFields).not.toContain("invitationStateFromFacts");
    expect(draftFields).toContain("stateChoices.map");
    expect(draftFields).toContain("selectInvitationProgress");
    expect(draftFields).toContain("AssessmentAvailabilityGrid");
    expect(draftFields).toContain("NextContactReminderField");
    expect(draftFields).toContain("invitationCanHaveNextContactReminder");
    expect(draftFields).toContain("draftCacheRef.current");
    expect(draftFields).toContain("window.sessionStorage.setItem");
    expect(draftFields).toContain("clearInvitationDraftSession");
    expect(draftFields).toContain("onConfirmedReadyRef.current?.(next)");
    expect(availabilityGrid).toContain("grid-cols-[5.5rem_repeat(7");
    expect(availabilityGrid).toContain("ASSESSMENT_SLOT_DEFINITIONS");
    expect(availabilityGrid).toContain('side === "direct"');
  });

  it("keeps intake in leads and moves editable contact rows into communication", () => {
    const page = read("src", "app", "[locale]", "dashboard", "followups", "leads", "page.tsx");
    const workbench = read("src", "features", "school", "LeadFirstContactWorkbench.tsx");
    const selection = read("src", "features", "school", "LeadPoolSelection.tsx");
    const actions = read("src", "features", "school", "actions", "leads.ts");
    const query = read("src", "features", "school", "leads.ts");
    expect(page).toContain("LeadIntakeWorkbench");
    expect(page).not.toContain("LeadFirstContactWorkbench");
    expect(page).toContain("FollowupTabs");
    expect(page).toContain("LeadPoolSelectionProvider");
    expect(page).toContain("LeadPoolBatchActions");
    expect(page).toContain("FilterSearchInput");
    expect(page).not.toContain("isFirstContactWorkbench");
    expect(page).not.toContain("LeadPoolTable");
    expect(workbench).toContain("FollowupInlineDetails");
    expect(workbench).not.toContain("FollowupDetails");
    expect(workbench).toContain("table-fixed");
    expect(workbench).not.toContain("focus:h-20");
    expect(workbench).not.toContain("DashboardInlineEntry");
    expect(workbench).toContain("canContact && Boolean(lead.ownerId)");
    expect(workbench).toContain('lead.status !== "converted"');
    expect(workbench).toContain("CONTACT_OUTCOME_SHORTCUTS");
    expect(workbench).toContain("FollowupChoice");
    expect(workbench).toContain("Control+Enter Meta+Enter");
    expect(workbench).toContain("school.followup.leads");
    expect(workbench).toContain("LeadIdentityControl");
    expect(workbench).toContain("selection.toggleLead");
    expect(workbench).toContain("event.shiftKey");
    expect(selection).toContain("selectionAnchorRef");
    expect(workbench).toContain("recordAndAdvance");
    expect(workbench).toContain("lastContactOutcome: input.outcome");
    expect(workbench).toContain("confirmableInvitation");
    expect(workbench).toContain("InvitationDraftFields");
    expect(workbench).toContain("NextContactReminderField");
    expect(workbench).toContain("setLeadContactReminderAction");
    expect(actions).toContain('authorizedClient("student.assign")');
    expect(actions).toContain('authorizedClient("followup.write")');
    expect(actions).toContain('supabase.rpc("record_lead_contact_v4"');
    expect(actions).toContain('supabase.rpc("set_lead_contact_reminder"');
    expect(query).toContain('.from("effective_lead_communications" as "lead_communications")');
    expect(query).toContain('.from("lead_invitation_threads")');
    expect(query).toContain('.from("lead_next_actions")');
    expect(query).toContain('canScopeAll ? "all" : "mine"');
  });

  it("previews the same automatic contact pools as the database rule", () => {
    expect(deriveLeadContactDestination("unreachable")).toBe("uncontacted");
    expect(deriveLeadContactDestination("connected")).toBe("contacted");
    expect(deriveLeadContactDestination("declined")).toBe("nurture");
    expect(deriveLeadContactDestination("invalid_number")).toBe("invalid");
  });

  it("requires concrete coordination facts only when the workflow has reached that state", () => {
    expect(defaultInvitationState("assessment_1v1")).toBe("coordinating_time");
    expect(defaultInvitationState("activity")).toBe("awaiting_parent");
    expect(defaultInvitationState("waiting_activity")).toBe("waiting_activity");
    expect(invitationCanHaveNextContactReminder({ state: "coordinating_time" })).toBe(true);
    expect(invitationCanHaveNextContactReminder({ state: "awaiting_teacher" })).toBe(true);
    expect(invitationCanHaveNextContactReminder({ state: "awaiting_parent" })).toBe(true);
    expect(invitationCanHaveNextContactReminder({ state: "waiting_activity" })).toBe(true);
    expect(invitationCanHaveNextContactReminder({ state: "confirmed" })).toBe(false);
    expect(invitationStatesForKind("assessment_1v1")).toEqual([
      "coordinating_time",
      "awaiting_teacher",
      "awaiting_parent",
      "confirmed",
    ]);
    expect(invitationDraftIsComplete({
      kind: "assessment_1v1",
      state: "coordinating_time",
      activityId: null,
      assessorId: null,
      parentTimeOptions: [],
      assessorTimeOptions: [],
      scheduledAt: null,
      locationText: "",
    })).toBe(true);
    expect(invitationDraftIsComplete({
      kind: "assessment_1v1",
      state: "awaiting_teacher",
      activityId: null,
      assessorId: null,
      parentTimeOptions: ["2026-09-05@after_school"],
      assessorTimeOptions: [],
      scheduledAt: null,
      locationText: "",
    })).toBe(false);
    expect(invitationDraftIsComplete({
      kind: "assessment_1v1",
      state: "awaiting_parent",
      activityId: null,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: ["2026-09-05@14:00"],
      scheduledAt: null,
      locationText: "一号教室",
    })).toBe(true);
    expect(invitationDraftIsComplete({
      kind: "assessment_1v1",
      state: "confirmed",
      activityId: null,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: ["2026-09-05@14:00"],
      scheduledAt: "2026-09-05T06:00:00.000Z",
      locationText: "一号教室",
    })).toBe(true);
    expect(assessmentAvailabilityIntersection(
      ["2026-09-05@after_school", "2026-09-05@14:00"],
      ["2026-09-05@14:00", "2026-09-05@16:00"],
    )).toEqual(["2026-09-05@14:00"]);
    expect(assessmentTimeOptionForInstant("2026-09-05T06:00:00.000Z")).toBe("2026-09-05@14:00");
    expect(assessmentTimeOptionForInstant("2026-09-05T08:30:00.000Z")).toBeNull();
    expect(assessmentTimeOptionToInstant("2026-09-05@14:00")).toBe("2026-09-05T06:00:00.000Z");
    expect(assessmentTimeOptionToInstant("2026-09-05@after_school")).toBeNull();
    expect(applyDirectAssessmentTime({
      kind: "assessment_1v1",
      state: "coordinating_time",
      activityId: null,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: [],
      assessorTimeOptions: [],
      scheduledAt: null,
      locationText: "",
    }, "2026-09-05@14:00")).toMatchObject({
      state: "confirmed",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: ["2026-09-05@14:00"],
      scheduledAt: "2026-09-05T06:00:00.000Z",
    });
    expect(applyDirectAssessmentTime({
      kind: "assessment_1v1",
      state: "coordinating_time",
      activityId: null,
      assessorId: null,
      parentTimeOptions: [],
      assessorTimeOptions: [],
      scheduledAt: null,
      locationText: "",
    }, "2026-09-05@14:00")).toBeNull();
    expect(applyDirectAssessmentTime({
      kind: "assessment_1v1",
      state: "awaiting_parent",
      activityId: null,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: [],
      assessorTimeOptions: [],
      scheduledAt: null,
      locationText: "",
    }, "2026-09-05@14:00", "awaiting_parent")).toMatchObject({
      state: "awaiting_parent",
      scheduledAt: "2026-09-05T06:00:00.000Z",
    });
    expect(selectInvitationProgress({
      kind: "assessment_1v1",
      state: "coordinating_time",
      activityId: null,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: ["2026-09-05@14:00"],
      scheduledAt: null,
      locationText: "",
    }, "awaiting_parent")).toMatchObject({
      state: "awaiting_parent",
      scheduledAt: "2026-09-05T06:00:00.000Z",
    });
    expect(selectInvitationProgress({
      kind: "assessment_1v1",
      state: "confirmed",
      activityId: null,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: ["2026-09-05@14:00"],
      scheduledAt: "2026-09-05T06:00:00.000Z",
      locationText: "",
    }, "awaiting_teacher")).toMatchObject({
      state: "awaiting_teacher",
      scheduledAt: null,
    });
    expect(invitationStateFromFacts({
      kind: "assessment_1v1",
      state: "confirmed",
      activityId: null,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: [],
      scheduledAt: null,
      locationText: "",
    })).toBe("awaiting_teacher");
    expect(invitationStateFromFacts({
      kind: "assessment_1v1",
      state: "coordinating_time",
      activityId: null,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: [],
      scheduledAt: null,
      locationText: "",
    })).toBe("awaiting_teacher");
  });

  it("derives the one action shown to learning support from recorded facts", () => {
    const base = {
      kind: "assessment_1v1" as const,
      state: "coordinating_time" as const,
      activityId: null,
      assessorId: null,
      parentTimeOptions: [] as string[],
      assessorTimeOptions: [] as string[],
      scheduledAt: null,
      locationText: "",
    };
    expect(invitationWorkStep(base)).toBe("collect_arrangement");
    expect(invitationWorkStep({
      ...base,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
    })).toBe("waiting_assessor");
    expect(invitationWorkStep({
      ...base,
      state: "awaiting_teacher",
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
    })).toBe("waiting_assessor_response");
    expect(invitationWorkStep({
      ...base,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: ["2026-09-05@16:00"],
    })).toBe("resolve_time_conflict");
    expect(invitationWorkStep({
      ...base,
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: ["2026-09-05@14:00"],
    })).toBe("choose_shared_time");
    expect(invitationWorkStep({
      ...base,
      state: "awaiting_parent",
      assessorId: "00000000-0000-0000-0000-000000000001",
      parentTimeOptions: ["2026-09-05@14:00"],
      assessorTimeOptions: ["2026-09-05@14:00"],
      scheduledAt: "2026-09-05T06:00:00.000Z",
    })).toBe("confirm_with_parent");
  });

  it("separates the coordination work queue from its current blocker", () => {
    expect(invitationQueueFrom(undefined)).toBe("all");
    expect(invitationQueueFrom("awaiting_teacher")).toBe("all");
    expect(invitationCoordinationStageFrom("awaiting_teacher", undefined)).toBe("awaiting_teacher");
    expect(invitationCoordinationStageFrom(undefined, "awaiting_parent")).toBe("awaiting_parent");
    expect(invitationCoordinationStageFrom("confirmed", "awaiting_parent")).toBe("awaiting_parent");
    expect(invitationQueueFrom("confirmed")).toBe("confirmed");
  });

  it("filters and sorts the currently loaded lead page by its data columns", () => {
    const makeLead = (overrides: Partial<LeadPoolRow>): LeadPoolRow => ({
      id: "lead-default",
      provisionalStudentName: "默认学生",
      phone: "13800000000",
      gradeHint: 3,
      gradeText: "",
      status: "uncontacted",
      ownerId: null,
      ownerName: "",
      suggestedStudentId: null,
      suggestedStudentName: "",
      createdAt: "2026-09-01T00:00:00.000Z",
      acquiredAt: null,
      acquisitionLocation: "",
      acquisitionMethod: "扫码填写",
      acquisitionPromoter: "推广员甲",
      sourceCount: 1,
      sourceMarkedDuplicate: false,
      interests: [],
      contactCount: 0,
      lastContactAt: null,
      lastContactOutcome: null,
      lastContactNote: "",
      wechatAdded: null,
      visitCommitted: null,
      interestLevel: null,
      nextContactAt: null,
      activeInvitation: null,
      ...overrides,
    });
    const rows = [
      makeLead({ id: "b", provisionalStudentName: "贝贝", interests: ["暑期课"] }),
      makeLead({
        id: "a",
        provisionalStudentName: "安安",
        status: "contacted",
        acquiredAt: "2026-09-01T02:00:00.000Z",
        acquisitionLocation: "合肥市包河区",
        ownerId: "staff-1",
        ownerName: "陈老师",
        lastContactAt: "2026-09-01T10:00:00.000Z",
        lastContactOutcome: "connected",
      }),
      makeLead({
        id: "c",
        provisionalStudentName: "聪聪",
        status: "nurture",
        acquiredAt: "2026-09-02T02:00:00.000Z",
        acquisitionLocation: "芜湖市镜湖区",
        ownerId: "staff-1",
        ownerName: "陈老师",
        lastContactAt: "2026-09-02T10:00:00.000Z",
        lastContactOutcome: "declined",
      }),
    ];

    expect(filterAndSortLeadRows(rows, { owner: NO_OWNER_FILTER }, null, "zh").map((row) => row.id))
      .toEqual(["b"]);
    expect(filterAndSortLeadRows(rows, { latestContact: NO_CONTACT_FILTER }, null, "zh").map((row) => row.id))
      .toEqual(["b"]);
    expect(filterAndSortLeadRows(rows, { acquisitionLocation: NO_ACQUISITION_LOCATION_FILTER }, null, "zh").map((row) => row.id))
      .toEqual(["b"]);
    expect(filterAndSortLeadRows(rows, { acquiredAt: NO_ACQUISITION_TIME_FILTER }, null, "zh").map((row) => row.id))
      .toEqual(["b"]);
    expect(filterAndSortLeadRows(rows, { acquiredAt: "2026-09-02" }, null, "zh").map((row) => row.id))
      .toEqual(["c"]);
    expect(filterAndSortLeadRows(rows, { owner: "staff-1", status: "contacted" }, null, "zh").map((row) => row.id))
      .toEqual(["a"]);
    expect(filterAndSortLeadRows(rows, { seed: "name:贝贝" }, null, "zh").map((row) => row.id))
      .toEqual(["b"]);
    expect(filterAndSortLeadRows(rows, { acquisitionLocation: "promoter:推广员甲" }, null, "zh").map((row) => row.id))
      .toEqual(["b", "a", "c"]);
    expect(filterAndSortLeadRows(rows, { latestContact: "contact-time:2026-09-02T10:00:00.000Z" }, null, "zh").map((row) => row.id))
      .toEqual(["c"]);
    expect(filterAndSortLeadRows(rows, {}, { column: "seed", direction: "asc" }, "zh").map((row) => row.id))
      .toEqual(["a", "b", "c"]);
    expect(filterAndSortLeadRows(rows, {}, { column: "latestContact", direction: "desc" }, "zh").map((row) => row.id))
      .toEqual(["c", "a", "b"]);
    expect(filterAndSortLeadRows(rows, {}, { column: "acquiredAt", direction: "desc" }, "zh").map((row) => row.id))
      .toEqual(["c", "a", "b"]);
  });

  it("uses client-safe contracts and explicit configurable shadcn pagination", () => {
    const page = read("src", "app", "[locale]", "dashboard", "followups", "leads", "page.tsx");
    const query = read("src", "features", "school", "leads.ts");
    const contract = read("src", "features", "school", "lead-contract.ts");
    const pagination = read("src", "features", "school", "LeadPoolPagination.tsx");
    const shadcnPagination = read("src", "components", "ui", "pagination.tsx");

    expect(query).toContain('import "server-only"');
    expect(query).toContain("filters.pageSize");
    expect(query).toContain("offset + (selectedLeadIds?.length ?? filters.pageSize) - 1");
    expect(contract).toContain("LEAD_PAGE_SIZES = [20, 50, 100]");
    expect(page).toContain("LeadPoolPagination");
    expect(page).toContain('name="pageSize"');
    expect(pagination).toContain("PaginationContent");
    expect(pagination).toContain("PaginationEllipsis");
    expect(pagination).toContain("LEAD_PAGE_SIZES.map");
    expect(pagination).toContain("router.replace(hrefFor(1, nextPageSize))");
    expect(pagination).not.toContain('from "./leads"');
    expect(shadcnPagination).toContain('data-slot="pagination"');
    expect(leadPaginationTokens(1, 11)).toEqual([1, 2, 3, 4, 5, "ellipsis-right", 11]);
    expect(leadPaginationTokens(6, 11)).toEqual([1, "ellipsis-left", 5, 6, 7, "ellipsis-right", 11]);
    expect(leadPaginationTokens(11, 11)).toEqual([1, "ellipsis-left", 7, 8, 9, 10, 11]);
    expect(parseLeadPageSize("20")).toBe(20);
    expect(parseLeadPageSize(["50", "100"])).toBe(50);
    expect(parseLeadPageSize("500")).toBe(100);
  });

  it("selects or clears an inclusive visible range from the plain-click anchor", () => {
    const orderedIds = ["lead-1", "lead-2", "lead-3", "lead-4", "lead-5"];
    const selected = updateLeadSelection({
      current: new Set(["lead-1"]),
      orderedIds,
      leadId: "lead-4",
      checked: true,
      anchorId: "lead-1",
      extendRange: true,
    });
    expect([...selected]).toEqual(["lead-1", "lead-2", "lead-3", "lead-4"]);

    const cleared = updateLeadSelection({
      current: selected,
      orderedIds,
      leadId: "lead-2",
      checked: false,
      anchorId: "lead-4",
      extendRange: true,
    });
    expect([...cleared]).toEqual(["lead-1"]);
  });
});
