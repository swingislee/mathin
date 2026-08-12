import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260812000400_sml0_courseware_lecture_capability.sql"),
  "utf8",
);
const assertions = fs.readFileSync(
  path.join(root, "supabase", "tests", "sml0_courseware_lecture_capability_assertions.sql"),
  "utf8",
);
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");

describe("SML-0 courseware lecture capability contract", () => {
  it("defines one strict capability vocabulary and permission mapping", () => {
    for (const capability of [
      "page.edit",
      "review.submit",
      "review.decide",
      "release.publish",
      "release.rollback",
      "release.emergency_publish",
    ]) {
      expect(migration).toContain(`'${capability}'`);
    }
    expect(migration).toContain("raise exception 'INVALID_COURSEWARE_CAPABILITY'");
    expect(migration).toContain("capability_permission := 'courseware.page.edit'");
    expect(migration).toContain("capability_permission := 'courseware.review'");
    expect(migration).toContain("capability_permission := 'courseware.release.publish'");
    expect(migration).toContain("capability_permission := 'courseware.emergency_publish'");
  });

  it("combines RBAC, effective responsibility, time window and lifecycle state", () => {
    expect(migration).toContain("public.has_perm(p_actor_id, capability_permission)");
    expect(migration).toContain("public.is_staff(p_actor_id)");
    expect(migration).toContain("assignment_value.starts_at <= p_at");
    expect(migration).toContain("assignment_value.ends_at > p_at");
    expect(migration).toContain("assignment_value.archived_at is null");
    expect(migration).toContain("'RELATION_REQUIRED'");
    expect(migration).toContain("'RESPONSIBILITY_REQUIRED'");
    expect(migration).toContain("'LECTURE_ARCHIVED'");
    expect(migration).toContain("'COURSE_TRASHED'");
    expect(migration).toContain("'LECTURE_NOT_ACTIVE'");
  });

  it("keeps nearest-owner inheritance distinct from inherited collaborators", () => {
    expect(migration).toContain("effective_owner as");
    expect(migration).toContain("order by owner_value.scope_rank");
    expect(migration).toContain("assignment_value.responsibility in ('editor', 'reviewer')");
    expect(assertions).toContain("nearest_owner_overrides_family");
    expect(assertions).toContain("inherited_editor_allowed");
    expect(assertions).toContain("inherited_reviewer_allowed");
  });

  it("does not let admin permission bypass the lecture relation", () => {
    expect(assertions).toContain("admin bypassed lecture relation");
    expect(assertions).toContain("denial_code = 'RELATION_REQUIRED'");
  });

  it("keeps the actor-selected resolver read-only and internal helpers private", () => {
    expect(migration).toContain(
      "revoke all on function public.resolve_cw_lecture_capability_for(uuid, uuid, text, timestamptz)",
    );
    expect(migration).toContain(
      "grant execute on function public.resolve_my_cw_lecture_capability(uuid, text) to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.assert_cw_lecture_capability(uuid, text)",
    );
    expect(migration).not.toContain("grant execute on function public.assert_cw_lecture_capability");
  });

  it("uses the same resolver for UI capability reads and transactional assertions", () => {
    const sharedCall = "public.resolve_cw_lecture_capability_for(auth.uid(), p_lecture_id, p_capability, now())";
    expect(migration.split(sharedCall)).toHaveLength(3);
    expect(migration).toContain("raise exception '%', capability_row.denial_code using errcode = '42501'");
  });

  it("has rollback-safe PostgreSQL assertions for positive and negative cases", () => {
    expect(assertions).toContain("begin;");
    expect(assertions).toContain("rollback;");
    expect(assertions).toContain("expired_relation_rejected");
    expect(assertions).toContain("draft_publish_rejected");
    expect(assertions).toContain("archived_lecture_rejected");
    expect(assertions).toContain("inactive_actor_rejected");
    expect(assertions).toContain("permission_checked_first");
    expect(assertions).toContain("sqlstate <> '42501'");
  });

  it("runs the SML database assertions in the database CI job", () => {
    expect(workflow).toContain("run: pnpm sml:db-audit");
  });
});
