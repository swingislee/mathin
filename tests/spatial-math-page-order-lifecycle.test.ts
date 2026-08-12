import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(...parts: string[]) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

describe("SML-0 active courseware page order", () => {
  it("scopes page-number uniqueness to active pages", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260813000300_sml0_active_courseware_page_order.sql",
    );

    expect(migration).toContain(
      "drop constraint if exists cw_page_docs_lecture_id_page_no_key",
    );
    expect(migration).toContain("generated always as");
    expect(migration).toContain("case when deleted_at is null then page_no else null end");
    expect(migration).toMatch(
      /constraint cw_page_docs_active_lecture_page_key[\s\S]*unique \(lecture_id, active_page_no\)[\s\S]*deferrable initially deferred/,
    );
  });

  it("recreates a spatial page at a soft-deleted active position without changing history", () => {
    const assertions = read(
      "supabase",
      "tests",
      "sml0_spatial_delivery_lifecycle_assertions.sql",
    );

    expect(assertions).toContain("Replacement after soft delete");
    expect(assertions).toContain("recreate_after_soft_delete_ok");
    expect(assertions).toContain("id = :'copied_page_id'");
    expect(assertions).toContain("id = :'replacement_page_id'");
  });
});
