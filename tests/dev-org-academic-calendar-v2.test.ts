import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260828000310_organization_academic_calendar_v2.sql"),
  "utf8",
);

describe("DEV-ORG-1 organization academic calendar", () => {
  it("merges identical academic years and keeps compatibility columns", () => {
    expect(migration).toContain("SCHOOL_YEAR_CONTENT_CONFLICT");
    expect(migration).toContain("update public.classrooms set term_id = canonical_term_id");
    expect(migration).toContain("school_years_start_year_org_unique_idx");
    expect(migration).not.toMatch(/drop\s+column\s+(?:if\s+exists\s+)?campus_id/i);
  });

  it("uses a single organization academic axis", () => {
    const currentYear = migration.match(/create or replace function public\.current_school_year_id[\s\S]+?\n\$\$;/)?.[0] ?? "";
    const currentTerm = migration.match(/create or replace function public\.current_school_term_id[\s\S]+?\n\$\$;/)?.[0] ?? "";
    expect(currentYear).not.toContain("where year_row.campus_id");
    expect(currentTerm).not.toContain("where term_row.campus_id");
    expect(migration).toContain("school_terms_one_current_org_idx");
    expect(migration).toContain("'scope', 'organization'");
  });

  it("supports closed ranges plus mapped and manual single days", () => {
    expect(migration).toContain("schedule_mode = 'mapped'");
    expect(migration).toContain("schedule_mode = 'manual'");
    expect(migration).toContain("TEACHING_DAY_MUST_BE_SINGLE_DATE");
    expect(migration).toContain("CALENDAR_SCOPE_OVERLAP");
    expect(migration).toContain("mapped_weekday between 0 and 6");
  });

  it("gives campus room-group entries precedence and marks pending locations", () => {
    expect(migration).toContain("order by (holiday_row.campus_id is not null) desc");
    expect(migration).toContain("'locationPending', p_room_id is null");
  });

  it("requires and audits a reason for manual closed-day scheduling", () => {
    expect(migration).toContain("CLOSED_DAY_CONFIRMATION_REQUIRED");
    expect(migration).toContain("session.closed_day.override_confirmed");
    expect(migration).toContain("p_closed_day_reason");
    expect(migration).toContain("current_room_id is distinct from p_room_id");
  });
});
