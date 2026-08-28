import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260828000340_legacy_rule_history_v2.sql"),
  "utf8",
);

describe("DEV-ORG-1 legacy rule history", () => {
  it("provides an audit-only reader without a V2 write surface", () => {
    expect(migration).toContain("list_legacy_organization_rule_history_v2");
    expect(migration).toContain("public.has_perm(uid, 'audit.view')");
    expect(migration).not.toContain("set_organization_rule_v2");
    expect(migration).not.toContain("rollback_organization_rule_v2");
  });

  it("exposes the historical campus name without internal codes", () => {
    expect(migration).toContain("'legacyCampusName', campus_row.name");
    expect(migration).not.toContain("campus_row.code");
  });
});
