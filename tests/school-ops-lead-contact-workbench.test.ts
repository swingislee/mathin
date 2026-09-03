import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { updateLeadSelection } from "@/features/school/lead-selection";

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
    const actions = read("src", "features", "school", "actions", "leads.ts");
    const query = read("src", "features", "school", "leads.ts");

    expect(page).toContain('value: "first_contact"');
    expect(page).toContain('status: "uncontacted"');
    expect(page).toContain("listStaffMembers");
    expect(table).toContain("assignSelected");
    expect(table).toContain("selectedCount");
    expect(table).toContain("event.shiftKey");
    expect(table).toContain("selectionAnchorRef");
    expect(table).toContain("recordFirstContact");
    expect(table).toContain("contactAutoFields");
    expect(table).not.toContain("DateTimePicker");
    expect(table).not.toContain('t("nextAction")');
    expect(table).not.toContain('t("source")');
    expect(actions).toContain('authorizedClient("student.assign")');
    expect(actions).toContain('authorizedClient("followup.write")');
    expect(actions).toContain('p_next_action_at: nullableRpcArg<string>(null)');
    expect(query).toContain('.from("lead_communications")');
    expect(query).not.toContain('.from("lead_next_actions")');
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
