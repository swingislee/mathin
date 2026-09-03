import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { updateLeadSelection } from "@/features/school/lead-selection";
import {
  filterAndSortLeadRows,
  NO_CONTACT_FILTER,
  NO_OWNER_FILTER,
} from "@/features/school/lead-table-view";
import { leadPaginationTokens } from "@/features/school/lead-pagination";
import { parseLeadPageSize, type LeadPoolRow } from "@/features/school/lead-contract";

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

  it("moves assigned seeds into a first-call queue atomically", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260902001300_school_ops_lead_contact_workbench.sql",
    );
    const assignment = migration.slice(
      migration.indexOf("create or replace function public.assign_leads"),
      migration.indexOf("create or replace function public.record_lead_contact"),
    );

    expect(assignment).toContain("cardinality(p_lead_ids) not between 1 and 100");
    expect(assignment).toContain("public.has_perm(v_uid, 'student.assign')");
    expect(assignment).toContain("public.has_perm(p_staff_user_id, 'followup.write')");
    expect(assignment).toContain("status = case when status = 'unassigned' then 'uncontacted'");
    expect(assignment).toContain("'initial_contact', now(), v_uid");
    expect(assignment).toContain("LEAD_SCOPE_MISMATCH");
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

  it("supports page and shift-range assignment without leaking next actions into the seed table", () => {
    const page = read("src", "app", "[locale]", "dashboard", "leads", "page.tsx");
    const table = read("src", "features", "school", "LeadPoolTable.tsx");
    const selection = read("src", "features", "school", "LeadPoolSelection.tsx");
    const columnHeader = read(
      "src",
      "features",
      "school",
      "dashboard-page",
      "DashboardTableColumnHeader.tsx",
    );
    const actions = read("src", "features", "school", "actions", "leads.ts");
    const query = read("src", "features", "school", "leads.ts");
    const tableView = read("src", "features", "school", "lead-table-view.ts");
    const contract = read("src", "features", "school", "lead-contract.ts");

    expect(page).toContain('value: "first_contact"');
    expect(page).toContain('status: "uncontacted"');
    expect(page).toContain("listStaffMembers");
    expect(page).toContain("LeadPoolSelectionProvider");
    expect(page).toContain("LeadPoolBatchActions");
    expect(page).toContain("FilterSearchInput");
    expect(page).not.toContain("allStatuses");
    expect(page).not.toContain("FilterSelectTrigger");
    expect(selection).toContain("assignSelected");
    expect(selection).toContain("selectedCount");
    expect(table).not.toContain("assignSelected");
    expect(table).not.toContain("selectedCount");
    expect(table).toMatch(/<DashboardTableShell>\s*<Table/);
    expect(table).toContain("event.shiftKey");
    expect(selection).toContain("selectionAnchorRef");
    expect(table).toContain("DashboardTableColumnHeader");
    expect(table).toContain("containerClassName");
    expect(table).toContain("sticky top-0");
    expect(columnHeader).toContain("Popover");
    expect(columnHeader).toContain("Select");
    expect(columnHeader).toContain("Button");
    expect(table).toContain("recordFirstContact");
    expect(table).toContain("contactAutoFields");
    expect(table).not.toContain("DateTimePicker");
    expect(table).not.toContain('t("nextAction")');
    expect(table).not.toContain('t("source")');
    expect(table).toContain('from "./lead-contract"');
    expect(table).not.toContain('from "./leads"');
    expect(tableView).toContain('from "./lead-contract"');
    expect(contract).not.toContain("@/lib/supabase/server");
    expect(actions).toContain('authorizedClient("student.assign")');
    expect(actions).toContain('authorizedClient("followup.write")');
    expect(actions).toContain('p_next_action_at: nullableRpcArg<string>(null)');
    expect(query).toContain('.from("lead_communications")');
    expect(query).not.toContain('.from("lead_next_actions")');
  });

  it("filters and sorts the currently loaded lead page by its data columns", () => {
    const makeLead = (overrides: Partial<LeadPoolRow>): LeadPoolRow => ({
      id: "lead-default",
      provisionalStudentName: "默认学生",
      phone: "13800000000",
      gradeHint: 3,
      gradeText: "",
      status: "unassigned",
      ownerId: null,
      ownerName: "",
      suggestedStudentId: null,
      suggestedStudentName: "",
      createdAt: "2026-09-01T00:00:00.000Z",
      sourceMarkedDuplicate: false,
      interests: [],
      contactCount: 0,
      lastContactAt: null,
      lastContactOutcome: null,
      lastContactNote: "",
      wechatAdded: null,
      visitCommitted: null,
      interestLevel: null,
      ...overrides,
    });
    const rows = [
      makeLead({ id: "b", provisionalStudentName: "贝贝", interests: ["暑期课"] }),
      makeLead({
        id: "a",
        provisionalStudentName: "安安",
        status: "contacted",
        ownerId: "staff-1",
        ownerName: "陈老师",
        lastContactAt: "2026-09-01T10:00:00.000Z",
        lastContactOutcome: "connected",
      }),
      makeLead({
        id: "c",
        provisionalStudentName: "聪聪",
        status: "nurture",
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
    expect(filterAndSortLeadRows(rows, { owner: "staff-1", status: "contacted" }, null, "zh").map((row) => row.id))
      .toEqual(["a"]);
    expect(filterAndSortLeadRows(rows, {}, { column: "seed", direction: "asc" }, "zh").map((row) => row.id))
      .toEqual(["a", "b", "c"]);
    expect(filterAndSortLeadRows(rows, {}, { column: "latestContact", direction: "desc" }, "zh").map((row) => row.id))
      .toEqual(["c", "a", "b"]);
  });

  it("uses client-safe contracts and explicit configurable shadcn pagination", () => {
    const page = read("src", "app", "[locale]", "dashboard", "leads", "page.tsx");
    const query = read("src", "features", "school", "leads.ts");
    const contract = read("src", "features", "school", "lead-contract.ts");
    const pagination = read("src", "features", "school", "LeadPoolPagination.tsx");
    const shadcnPagination = read("src", "components", "ui", "pagination.tsx");

    expect(query).toContain('import "server-only"');
    expect(query).toContain("filters.pageSize");
    expect(query).toContain("offset + filters.pageSize - 1");
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
