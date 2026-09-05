import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  renewalPoolCounts,
  renewalPoolRowsForView,
  type LongTermOpportunityRow,
} from "@/features/school/renewal-contract";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

function opportunity(
  id: string,
  stage: LongTermOpportunityRow["stage"],
  overrides: Partial<LongTermOpportunityRow> = {},
): LongTermOpportunityRow {
  return {
    id,
    opportunityType: "renewal",
    studentId: `student-${id}`,
    studentName: id,
    grade: 5,
    courseId: "course-1",
    courseTitle: "五年级思维",
    termId: "term-next",
    termName: "2026–2027 学年 · 寒假",
    stage,
    ownerId: "owner-1",
    ownerName: "学辅老师",
    nextAction: "确认下周期安排",
    nextActionAt: null,
    note: "",
    cycleId: "cycle-1",
    cycleName: "秋续寒",
    sourceMembershipId: `membership-${id}`,
    sourceClassroomName: "五年级秋季班",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("school operations Phase 5 renewal lifecycle", () => {
  it("derives renewal work queues from opportunity facts", () => {
    const rows = [
      opportunity("安安", "planning", { nextActionAt: "2026-09-07T00:00:00.000Z" }),
      opportunity("贝贝", "payment_pending", { nextActionAt: "2026-09-06T00:00:00.000Z" }),
      opportunity("辰辰", "enrolled"),
      opportunity("朵朵", "not_enrolled"),
    ];

    expect(renewalPoolCounts(rows)).toEqual({ active: 2, committed: 1, closed: 2, all: 4 });
    expect(renewalPoolRowsForView(rows, { view: "active", cycleId: "cycle-1", query: "" }, "zh")
      .map((row) => row.studentName)).toEqual(["贝贝", "安安"]);
    expect(renewalPoolRowsForView(rows, { view: "closed", cycleId: null, query: "辰" }, "zh")
      .map((row) => row.studentName)).toEqual(["辰辰"]);
  });

  it("keeps renewal, teacher signal, reactivation, and referral on stable identities", () => {
    const migration = read("supabase", "migrations", "20260905000400_school_ops_phase5_renewal_lifecycle.sql");
    const actions = read("src", "features", "school", "actions", "renewals.ts");
    const growthWorkspace = read("src", "features", "school", "LongTermGrowthWorkspace.tsx");
    expect(migration).toContain("create table public.renewal_cycles");
    expect(migration).toContain("create table public.renewal_cycle_entries");
    expect(migration).toContain("create table public.teacher_professional_signals");
    expect(migration).toContain("create table public.student_referrals");
    expect(migration).toContain("public.save_course_opportunity(");
    expect(migration).not.toContain("insert into public.course_opportunities");
    expect(migration).toContain("'renewal'");
    expect(migration).toContain("'reactivate'");
    expect(migration).toContain("referrer_student_id");
    expect(migration).toContain("referred_lead_id");
    expect(migration).toContain("insert into public.leads(");
    expect(migration).toContain("public.normalize_school_ops_phone");
    expect(migration).toContain("unique (referrer_student_id, referred_lead_id)");
    expect(migration).toContain("join public.family_students family_student");
    expect(migration).toContain("v_membership.joined_at <= coalesce(v_session.started_at, v_session.scheduled_at)");
    expect(migration).toContain("v_membership.status not in ('active', 'completed')");
    expect(migration).not.toContain("membership.status in ('active', 'completed');");
    expect(migration).toContain("v_session.teacher_override = v_uid");
    expect(migration).toContain("source_session_id uuid references public.class_sessions(id) on delete restrict");
    expect(migration).not.toContain("create or replace function public.update_student_referral");
    const referralTable = migration.match(/create table public\.student_referrals \([\s\S]*?\n\);/)?.[0] ?? "";
    expect(referralTable).not.toContain("owner_id");
    expect(referralTable).not.toContain("status text");
    expect(actions).toContain("p_new_lead_name");
    expect(actions).toContain('p_opportunity_type: "reactivate"');
    expect(actions).not.toContain("updateStudentReferralAction");
    expect(growthWorkspace).toContain('"existing" | "new"');
    expect(growthWorkspace).toContain("createLeadSeed");
    expect(migration).not.toContain("insert into public.students");
  });

  it("ships the four LAN acceptance surfaces and bilingual copy", () => {
    for (const page of [
      ["renewals", "page.tsx"],
      ["renewals", "[opportunityId]", "page.tsx"],
      ["renewals", "signals", "page.tsx"],
      ["renewals", "growth", "page.tsx"],
    ]) {
      expect(fs.existsSync(path.join(root, "src", "app", "[locale]", "dashboard", ...page))).toBe(true);
    }
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");
    for (const key of ["renewals", "renewalPool", "teacherSignals", "reactivationAndReferrals"]) {
      expect(zh).toContain(`\"${key}\"`);
      expect(en).toContain(`\"${key}\"`);
    }
  });
});
