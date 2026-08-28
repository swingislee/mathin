import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260828000300_organization_location_v2.sql"),
  "utf8",
);

describe("DEV-ORG-1 location V2 contract", () => {
  it("keeps legacy location fields while adding structured room references", () => {
    expect(migration).toContain("add column if not exists default_room_id uuid");
    expect(migration).toContain("add column if not exists room_id uuid");
    expect(migration).toContain("room_assignment_origin in ('class_default', 'session_override')");
    expect(migration).not.toMatch(/drop\s+column\s+(?:if\s+exists\s+)?room\b/i);
  });

  it("fails closed for ambiguous legacy locations and scoped overrides", () => {
    expect(migration).toContain("AMBIGUOUS_LEGACY_ROOM");
    expect(migration).toContain("UNRESOLVED_LEGACY_ROOM");
    expect(migration).toContain("ACTIVE_CAMPUS_OVERRIDE_REQUIRES_MAPPING");
    expect(migration).toContain("DUPLICATE_SCHOOL_YEAR_REQUIRES_ORG_MERGE");
  });

  it("exposes code-free V2 DTOs and split permissions", () => {
    expect(migration).toContain("'organization.profile.manage','location.manage'");
    expect(migration).toContain("get_organization_profile_v2");
    expect(migration).toContain("get_location_catalog_v2");
    const catalogBody = migration.match(/create or replace function public\.get_location_catalog_v2[\s\S]+?\n\$\$;/)?.[0] ?? "";
    expect(catalogBody).not.toContain("'code'");
    expect(catalogBody).not.toContain("'timezone'");
    expect(catalogBody).not.toContain("'isDefault'");
  });

  it("preserves explicit overrides and history during propagation and archival", () => {
    expect(migration).toContain("room_assignment_origin = 'class_default'");
    expect(migration).toContain("room_assignment_origin = 'session_override'");
    expect(migration).toMatch(/started_at is null and ended_at is null/);
    expect(migration).toContain("historicalSessionCount");
    expect(migration).toContain("LOCATION_IMPACT_STALE");
  });

  it("detects room conflicts by UUID", () => {
    expect(migration).toContain("session_row.room_id = p_room_id");
    expect(migration).toContain("get_class_build_conflicts_v2");
  });
});
