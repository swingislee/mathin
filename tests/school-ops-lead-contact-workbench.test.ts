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

  it("separates dense seed management from the inline first-contact entry table", () => {
    const page = read("src", "app", "[locale]", "dashboard", "leads", "page.tsx");
    const table = read("src", "features", "school", "LeadPoolTable.tsx");
    const workbench = read("src", "features", "school", "LeadFirstContactWorkbench.tsx");
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
    expect(page).toContain("LeadFirstContactWorkbench");
    expect(page).toContain("isFirstContactWorkbench");
    expect(workbench).toMatch(/<DashboardTableShell>\s*<Table/);
    expect(workbench).toContain("sticky left-0");
    expect(workbench).toContain("recordLeadContactAction");
    expect(workbench).toContain("deriveLeadContactDestination");
    expect(workbench).toContain("contactDestination");
    expect(workbench).toContain('event.key === "Enter"');
    expect(workbench).toContain("CONTACT_OUTCOME_SHORTCUTS");
    expect(workbench).toContain("DirectChoiceGroup");
    expect(workbench).toContain("advanceAfter");
    expect(workbench).toContain("rows={reachable ? 2 : 1}");
    expect(workbench).toContain("lead.lastContactOutcome");
    expect(workbench).toContain("active && outcome");
    expect(workbench).toContain('outcome === "connected"');
    expect(workbench).toContain("contactNotePlaceholder_${outcome}");
    expect(workbench).not.toContain("QUICK_SUBMIT_OUTCOMES");
    expect(workbench).not.toContain("<Select");
    expect(workbench).not.toContain("DateTimePicker");
    expect(workbench).not.toContain('t("nextAction")');
    expect(table).not.toContain("recordLeadContactAction");
    expect(table).not.toContain("Dialog");
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

  it("previews the same automatic contact pools as the database rule", () => {
    expect(deriveLeadContactDestination("unreachable", false)).toBe("uncontacted");
    expect(deriveLeadContactDestination("connected", false)).toBe("contacted");
    expect(deriveLeadContactDestination("declined", false)).toBe("nurture");
    expect(deriveLeadContactDestination("connected", true)).toBe("intent_confirmed");
    expect(deriveLeadContactDestination("invalid_number", false)).toBe("invalid");
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
    expect(filterAndSortLeadRows(rows, {}, { column: "seed", direction: "asc" }, "zh").map((row) => row.id))
      .toEqual(["a", "b", "c"]);
    expect(filterAndSortLeadRows(rows, {}, { column: "latestContact", direction: "desc" }, "zh").map((row) => row.id))
      .toEqual(["c", "a", "b"]);
    expect(filterAndSortLeadRows(rows, {}, { column: "acquiredAt", direction: "desc" }, "zh").map((row) => row.id))
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
