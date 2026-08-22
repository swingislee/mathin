import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260823000100_r1_live_school_year_periods.sql");
const manager = read("src/features/school/TermManager.tsx");
const actions = read("src/features/school/actions/courses.ts");

describe("R1-Live academic-year contract", () => {
  it("models four date-optional periods with summer as the new grade's first period", () => {
    expect(migration).toContain("1=暑期、2=秋季、3=寒假、4=春季");
    expect(migration).toContain("alter column starts_on drop not null");
    expect(migration).toContain("(starts_on is null and ends_on is null)");
    expect(migration).toContain("cross join (values (1::smallint, '暑期'), (2::smallint, '秋季'), (3::smallint, '寒假'), (4::smallint, '春季'))");
  });

  it("corrects the confirmed spring boundary and only re-attributes later production classes", () => {
    expect(migration).toContain("ends_on = date '2026-06-29'");
    expect(migration).toContain("classroom.purpose = 'production'");
    expect(migration).toContain("session_row.scheduled_at::date <= date '2026-06-29'");
    const migrationBeforeActivation = migration.slice(0, migration.indexOf("create or replace function public.activate_school_year"));
    expect(migrationBeforeActivation).not.toContain("set grade = grade + 1");
  });

  it("keeps creation and period switching separate from previewed grade promotion", () => {
    expect(actions).toContain('rpc("create_school_year"');
    expect(actions).toContain('rpc("activate_school_term"');
    expect(actions).toContain('rpc("activate_school_year"');
    expect(actions).toContain("p_expected_promote_count");
    expect(manager).toContain("schoolYearActivationConfirm");
    expect(manager).toContain("ConfirmDialog");
  });

  it("shows one selected academic year at a time instead of expanding every year", () => {
    expect(manager).toContain("selectedYearId");
    expect(manager).toContain("setSelectedYearId");
    expect(manager).toContain("<SelectItem");
    expect(manager).toContain("selectedYear.periods.map");
    expect(manager).not.toContain("max-h-[62vh] space-y-4");
  });

  it("validates date pairs inline while leaving overlap as a non-blocking warning", () => {
    expect(manager).toContain('role="alert"');
    expect(manager).toContain("termDatesIncomplete");
    expect(manager).toContain("termDatesReversed");
    expect(manager).toContain("termDatesOverlap");
    expect(manager).toContain("disabled={pending || incomplete || reversed}");
    expect(manager).not.toContain("disabled={pending || incomplete || reversed || overlap}");
  });
});
