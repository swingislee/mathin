import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260828000320_capability_release_v2.sql"),
  "utf8",
);

describe("DEV-ORG-1 organization capability release", () => {
  it("uses organization-only DTOs and preserves legacy rollback RPCs", () => {
    expect(migration).toContain("list_capability_release_v2");
    expect(migration).toContain("version_row.campus_id is null");
    expect(migration).not.toMatch(/drop\s+function\s+public\.set_feature_flag/i);
    expect(migration).not.toMatch(/drop\s+column\s+(?:if\s+exists\s+)?campus_id/i);
  });

  it("separates history read permission from capability writes", () => {
    expect(migration).toContain("public.has_perm(uid, 'audit.view')");
    expect(migration).toContain("public.has_perm(uid, 'system.operations.manage')");
    expect(migration).toContain("set_feature_flag_v2");
    expect(migration).toContain("rollback_feature_flag_v2");
  });

  it("keeps the finance release gate read-only closed", () => {
    expect(migration).toContain("p_flag_key = 'finance.enabled'");
    expect(migration).toContain("FINANCE_RELEASE_CLOSED");
    expect(migration).toContain("'financeReleaseLocked'");
  });
});
