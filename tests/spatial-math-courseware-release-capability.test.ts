import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260812000600_sml0_courseware_release_capability.sql",
  ),
  "utf8",
);
const assertions = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "tests",
    "sml0_courseware_release_capability_assertions.sql",
  ),
  "utf8",
);

describe("SML-0 courseware release capability wiring", () => {
  it("keeps all six public release RPC signatures stable", () => {
    for (const signature of [
      "public.publish_cw_track_release(",
      "public.rollback_cw_track_release(",
      "public.publish_cw_review_cycle(",
      "public.emergency_publish_cw_review(",
      "public.rollback_cw_lecture_release(",
      "public.publish_cw_adapt_releases(",
    ]) {
      expect(migration).toContain(`create function ${signature}`);
    }
  });

  it("routes ordinary publish and rollback through owner/editor capability", () => {
    expect(migration).toContain(
      "public.assert_cw_lecture_capability(p_lecture_id, 'release.publish')",
    );
    expect(migration).toContain(
      "public.assert_cw_lecture_capability(p_lecture_id, 'release.rollback')",
    );
    expect(migration).toContain(
      "public.assert_cw_lecture_capability(requested_lecture_id, 'release.publish')",
    );
  });

  it("requires the effective owner for emergency publish", () => {
    expect(migration).toContain(
      "public.assert_cw_lecture_capability(p_lecture_id, 'release.emergency_publish')",
    );
  });

  it("resolves the legacy rollback track from its immutable source release", () => {
    const legacyWrapper = migration.match(
      /create function public\.rollback_cw_lecture_release[\s\S]*?\n\$\$;/,
    )?.[0];
    expect(legacyWrapper).toBeDefined();
    expect(legacyWrapper).toContain("select release_value.track into release_track");
    expect(legacyWrapper).toContain("rollback_cw_track_release_pre_sml0_impl");
    expect(legacyWrapper).not.toContain("rollback_cw_lecture_release_pre_sml0_impl(");
  });

  it("preflights the complete adaptation batch before the old publish loop", () => {
    const batchWrapper = migration.match(
      /create function public\.publish_cw_adapt_releases[\s\S]*?\n\$\$;/,
    )?.[0];
    expect(batchWrapper).toBeDefined();
    const capabilityIndex = batchWrapper!.indexOf(
      "assert_cw_lecture_capability(requested_lecture_id, 'release.publish')",
    );
    const implementationIndex = batchWrapper!.indexOf(
      "publish_cw_adapt_releases_pre_sml0_impl",
    );
    expect(capabilityIndex).toBeGreaterThan(-1);
    expect(implementationIndex).toBeGreaterThan(capabilityIndex);
    expect(batchWrapper).toContain(
      "resolve_cw_lecture_capability_for(\n    auth.uid(),\n    null,",
    );
  });

  it("makes every pre-SML release implementation private", () => {
    const renamed = migration.match(/rename to ([a-z0-9_]+_pre_sml0_impl);/g) ?? [];
    expect(renamed).toHaveLength(6);
    expect(migration).not.toMatch(
      /grant execute on function public\.[a-z0-9_]+_pre_sml0_impl/,
    );
    expect(migration).toContain(
      "revoke all on function public.publish_cw_track_release_pre_sml0_impl",
    );
    expect(migration).toContain(
      "revoke all on function public.publish_cw_adapt_releases_pre_sml0_impl",
    );
  });

  it("keeps classroom freeze on its separate session-teacher boundary", () => {
    expect(migration).not.toContain("alter function public.freeze_session_courseware");
    expect(migration).not.toContain("create function public.freeze_session_courseware");
    expect(assertions).toContain("session_teacher_freeze_ok");
    expect(assertions).toContain("not exists (\n    select 1 from public.course_staff_assignments");
  });

  it("has rollback-safe PostgreSQL assertions for every release path", () => {
    expect(assertions).toContain("begin;");
    expect(assertions).toContain("rollback;");
    expect(assertions).toContain("SML0_RELEASE_MISSING_RELATION_ACCEPTED");
    expect(assertions).toContain("SML0_REVIEWER_PUBLISHED_RELEASE");
    expect(assertions).toContain("SML0_REVIEW_PUBLISH_WITHOUT_EDITOR_ACCEPTED");
    expect(assertions).toContain("SML0_EDITOR_EMERGENCY_PUBLISHED");
    expect(assertions).toContain("track_rollback_ok");
    expect(assertions).toContain("legacy_rollback_ok");
    expect(assertions).toContain("batch_release_ok");
    expect(assertions).toContain("review_release_ok");
    expect(assertions).toContain("emergency_release_ok");
  });

  it("uses one atomic migration transaction", () => {
    expect(migration.trimStart().includes("begin;")).toBe(true);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
  });
});
