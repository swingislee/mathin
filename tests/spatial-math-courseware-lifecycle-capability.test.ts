import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260812000500_sml0_courseware_lifecycle_capability.sql",
  ),
  "utf8",
);
const assertions = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "tests",
    "sml0_courseware_lifecycle_capability_assertions.sql",
  ),
  "utf8",
);

describe("SML-0 courseware lifecycle capability wiring", () => {
  it("keeps the public edit and review RPC signatures stable", () => {
    for (const signature of [
      "public.reorder_cw_pages(p_lecture_id uuid, p_page_ids uuid[])",
      "public.copy_cw_page(",
      "public.create_blank_cw_page(",
      "public.soft_delete_cw_page(p_page_doc_id uuid)",
      "public.revert_cw_page_revision(",
      "public.save_cw_track_page_draft(",
      "public.revert_cw_track_page_revision(",
      "public.set_cw_page_learning_check_flag(",
      "public.submit_cw_review(",
      "public.withdraw_cw_review(p_review_cycle_id uuid)",
      "public.approve_cw_review(",
      "public.reject_cw_review(",
      "public.review_cw_adapt_page(",
    ]) {
      expect(migration).toContain(`create function ${signature}`);
    }
  });

  it("routes page mutations through page.edit capability", () => {
    expect(migration.match(/'page\.edit'/g)).toHaveLength(8);
    expect(migration).toContain(
      "public.assert_cw_lecture_capability(p_target_lecture_id, 'page.edit')",
    );
    expect(migration).toContain(
      "public.assert_cw_page_capability(p_page_doc_id, 'page.edit')",
    );
  });

  it("separates review submission from review decisions", () => {
    expect(migration.match(/'review\.submit'/g)).toHaveLength(2);
    expect(migration.match(/'review\.decide'/g)).toHaveLength(3);
    expect(migration).toContain(
      "public.assert_cw_lecture_capability(p_lecture_id, 'review.submit')",
    );
    expect(migration).toContain(
      "public.assert_cw_review_cycle_capability(p_review_cycle_id, 'review.decide')",
    );
    const adaptImplementation = migration.match(
      /create or replace function public\.review_cw_adapt_page_pre_sml0_impl[\s\S]*?\n\$\$;/,
    )?.[0];
    expect(adaptImplementation).toBeDefined();
    expect(adaptImplementation).not.toContain("courseware.page.edit");
  });

  it("checks permission before resolving page or review-cycle identity", () => {
    expect(migration).toContain(
      "public.resolve_cw_lecture_capability_for(auth.uid(), null, p_capability, now())",
    );
    expect(migration).toContain(
      "preflight.denial_code is distinct from 'LECTURE_NOT_FOUND'",
    );
    expect(migration).toContain("raise exception 'PAGE_NOT_FOUND'");
    expect(migration).toContain("raise exception 'REVIEW_CYCLE_NOT_FOUND'");
  });

  it("makes every pre-SML implementation private to trusted wrappers", () => {
    const renamed = migration.match(/rename to ([a-z0-9_]+_pre_sml0_impl);/g) ?? [];
    expect(renamed).toHaveLength(13);
    expect(migration).not.toMatch(
      /grant execute on function public\.[a-z0-9_]+_pre_sml0_impl/,
    );
    expect(migration).toContain(
      "revoke all on function public.save_cw_track_page_draft_pre_sml0_impl",
    );
    expect(migration).toContain(
      "revoke all on function public.approve_cw_review_pre_sml0_impl",
    );
  });

  it("keeps release, rollback and freeze outside this bounded increment", () => {
    expect(migration).not.toContain("alter function public.publish_cw_track_release");
    expect(migration).not.toContain("alter function public.publish_cw_review_cycle");
    expect(migration).not.toContain("alter function public.rollback_cw_track_release");
    expect(migration).not.toContain("alter function public.freeze_session_courseware");
  });

  it("has rollback-safe PostgreSQL assertions for denial and positive workflows", () => {
    expect(assertions).toContain("begin;");
    expect(assertions).toContain("rollback;");
    expect(assertions).toContain("SML0_MISSING_RELATION_WRITE_ACCEPTED");
    expect(assertions).toContain("editor_page_flow_ok");
    expect(assertions).toContain("review_approved");
    expect(assertions).toContain("review_rejected");
    expect(assertions).toContain("review_only_adapt_allowed");
    expect(assertions).toContain("SML0_ARCHIVED_PAGE_WRITE_ACCEPTED");
  });

  it("proves internal implementations are not executable by authenticated", () => {
    expect(assertions).toContain("internal implementation execute grant leaked");
    expect(assertions).toContain(
      "has_function_privilege('authenticated', 'public.create_blank_cw_page(uuid,uuid,text)', 'EXECUTE')",
    );
  });
});
