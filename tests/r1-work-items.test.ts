import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const legacy = read("supabase/migrations/20260720001700_p4i6_work_item_projection.sql");
const migration = read("supabase/migrations/20260728000500_r1_work_items_approvals.sql");

describe("R1-4 hybrid work-item contracts", () => {
  it("preserves all 11 domain projection kinds and unions durable and approval sources", () => {
    const kinds = [
      "review.fix", "review.approve", "review.publish", "session.prepare", "session.task",
      "support.task", "leave_request.decide", "student.followup", "refund.approve",
      "classroom.no_primary_teacher", "session.overdue_not_started",
    ];
    for (const kind of kinds) expect(legacy).toContain(`'${kind}'`);
    expect(migration).toContain("rename to list_my_domain_work_items");
    expect(migration).toContain("union all select * from durable_items");
    expect(migration).toContain("union all select * from approval_items");
  });

  it("keeps domain completion outside the generic command boundary", () => {
    const closeFunction = migration.slice(
      migration.indexOf("create or replace function public.close_durable_work_item"),
      migration.indexOf("create or replace function public.request_approval"),
    );
    expect(closeFunction).toContain("from public.work_items");
    expect(closeFunction).not.toContain("list_my_domain_work_items");
    expect(closeFunction).not.toContain("work_key");
    expect(migration).toContain("domain completion remains in domain RPCs");
  });

  it("stores due_at while deriving overdue and explicit unified action fields at read time", () => {
    const durableTable = migration.slice(
      migration.indexOf("create table public.work_items"),
      migration.indexOf("create table public.work_item_assignments"),
    );
    expect(durableTable).toContain("due_at timestamptz");
    expect(durableTable).not.toContain("overdue boolean");
    expect(migration).toContain("public.classify_work_item_urgency(item_row.due_at");
    expect(migration).toContain("source_kind text, source_id text, action_kind text, action_href text");
    expect(migration).toContain("assignee_id uuid, assignee_name text, priority text, read_state text");
  });

  it("makes writes RPC-only, idempotent, notified, and decisions immutable", () => {
    expect(migration).toContain("IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("FORBIDDEN_SELF_APPROVAL");
    expect(migration).toContain("approval_decisions_immutable");
    expect(migration).toContain("work_item_assignments_immutable");
    expect(migration).toContain("perform public.emit_domain_event('work_item.assigned'");
    expect(migration).toContain("perform public.emit_domain_event('approval.requested'");
    expect(migration).toContain("grant select on public.work_items");
    expect(migration).not.toContain("grant insert on public.work_items");
  });

  it("ships zod actions and a client-leaf coordination/decision UI", () => {
    const actions = read("src/features/school/actions/work-items.ts");
    const panel = read("src/features/school/WorkCoordinationPanel.tsx");
    const decisions = read("src/features/school/stage/WorkItemDecisionActions.tsx");
    expect(actions).toContain("createDurableWorkItemSchema");
    expect(actions).toContain("requestApprovalSchema");
    expect(actions).toContain('rpc("close_durable_work_item"');
    expect(actions).toContain('rpc("decide_approval"');
    expect(panel).toContain('"use client"');
    expect(panel).toContain("createDurableWorkItemAction");
    expect(decisions).toContain('item.actionKind !== "work_item.close"');
    expect(decisions).toContain('item.actionKind !== "approval.decide"');
  });

  it("includes executable permission, idempotency, notification, and PERF-04 assertions", () => {
    const sql = read("supabase/tests/r1_work_items_assertions.sql");
    expect(sql).toContain("R1_DOMAIN_ITEM_GENERIC_CLOSE_WAS_ACCEPTED");
    expect(sql).toContain("R1_NON_MANAGER_CROSS_ASSIGNMENT_WAS_ACCEPTED");
    expect(sql).toContain("R1_SELF_APPROVAL_WAS_ACCEPTED");
    expect(sql).toContain("approval_notification_once");
    expect(sql).toContain("synthetic_rows=30000");
    expect(sql).toContain("R1_PERF04_P95_FAILED");
    expect(sql).toContain("R1_PERF04_P99_FAILED");
  });
});
