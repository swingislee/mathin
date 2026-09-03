import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCoursewareWorkspaceRolloutPlan,
  REQUIRED_MIGRATIONS,
} from "../scripts/lib/courseware-workspace-rollout.mjs";
import {
  COURSEWARE_WORKSPACE_CANDIDATE_MIGRATIONS,
  stripMigrationTransaction,
} from "../scripts/lib/courseware-workspace-candidate.mjs";

const snapshot = {
  databaseFingerprint: "production-safe-fingerprint",
  migrationHead: "20260903000700_courseware_page_insertions",
  appliedRequiredMigrations: [...REQUIRED_MIGRATIONS],
  functions: { registerInsertedAsset: true, sourceRuntimePatchGate: true },
  pageGroups: [
    { sourceSystem: "aixuexi_bsk", docVersion: "source-runtime-page-v1", pages: 5_508 },
    { sourceSystem: "mofaxiao_or_page_doc", docVersion: "page-doc-v1", pages: 71_553 },
    { sourceSystem: "unregistered", docVersion: "aixuexi-page-doc-v1", pages: 1 },
  ],
  trackGroups: [
    { sourceSystem: "aixuexi_bsk", track: "native-16x9", docVersion: "source-runtime-page-v1", trackHeads: 5_508, draftHeads: 1, currentHeads: 5_508, divergedDraftHeads: 1 },
    { sourceSystem: "aixuexi_bsk", track: "adapted-4x3", docVersion: "source-runtime-page-v1", trackHeads: 5_508, draftHeads: 1, currentHeads: 5_508, divergedDraftHeads: 1 },
    { sourceSystem: "mofaxiao_or_page_doc", track: "native-16x9", docVersion: "page-doc-v1", trackHeads: 71_553, draftHeads: 1, currentHeads: 71_553, divergedDraftHeads: 1 },
    { sourceSystem: "unregistered", track: "native-16x9", docVersion: "aixuexi-page-doc-v1", trackHeads: 1, draftHeads: 0, currentHeads: 1, divergedDraftHeads: 0 },
  ],
  bindingGroups: [{ track: "native-16x9", kind: "image", bindings: 1_000 }],
  releaseGroups: [{ track: "native-16x9", releases: 1_305, lectures: 1_305, maxReleaseNo: 2 }],
  frozenSessionCount: 4,
};

describe("courseware workspace rollout inventory", () => {
  it("keeps the narrow release candidate to six courseware migrations", () => {
    expect(COURSEWARE_WORKSPACE_CANDIDATE_MIGRATIONS).toEqual([
      "20260831000100_courseware_page_rename.sql",
      "20260901000100_courseware_adapted_draft_bootstrap.sql",
      "20260902000100_courseware_admin_object_capability.sql",
      "20260902000500_courseware_legacy_publish_retirement.sql",
      "20260902000900_courseware_source_runtime_drafts.sql",
      "20260903000700_courseware_page_insertions.sql",
    ]);
    expect(stripMigrationTransaction("begin;\r\nselect 1;\r\ncommit;\r\n")).toBe("select 1;\n");
  });

  it("pins the application candidate instead of silently following a moving HEAD", () => {
    const cli = readFileSync("scripts/courseware-workspace-rollout-audit.mjs", "utf8");

    expect(cli).toContain("--application-commit");
    expect(cli).toContain("--ssh-target");
    expect(cli).toContain("BatchMode=yes");
    expect(cli).toContain("repeatable read read only");
    expect(cli).toContain("rev-parse");
    expect(cli).toContain("--verify");
  });

  it("proves the shared insertion rollout needs no existing page or binding rewrite", () => {
    const plan = buildCoursewareWorkspaceRolloutPlan(snapshot, {
      environment: "local",
      executionHost: "dev-host",
      databaseTarget: "docker:supabase-db",
      applicationCommit: "abc123",
      generatedAt: "2026-09-03T00:00:00.000Z",
    });

    expect(plan.inventory.logicalPages).toBe(77_062);
    expect(plan.target.databaseFingerprint).toBe("production-safe-fingerprint");
    expect(plan.inventory.formalEditablePages).toBe(77_061);
    expect(plan.inventory.insertableTrackHeads).toBe(82_569);
    expect(plan.rollout.existingPageRowsToRewrite).toBe(0);
    expect(plan.rollout.existingBindingsToRewrite).toBe(0);
    expect(plan.rollout.storageObjectsToPreupload).toBe(0);
    expect(plan.rollout.releaseHeadsAdvancedByMigration).toBe(0);
    expect(plan.rollout.frozenSessionsMutatedByMigration).toBe(0);
    expect(plan.decision.localDryRunReady).toBe(true);
    expect(plan.decision.targetSchemaReady).toBe(true);
    expect(plan.decision.productionInventoryCaptured).toBe(false);
    expect(plan.decision.productionCandidateReady).toBe(false);
    expect(plan.decision.blockers).toContain("production-read-only-inventory-not-captured");
    expect(plan.inventory.excludedGroups).toEqual([
      expect.objectContaining({ docVersion: "aixuexi-page-doc-v1", trackHeads: 1 }),
    ]);
  });

  it("fails closed when either required migration or function is absent", () => {
    const plan = buildCoursewareWorkspaceRolloutPlan({
      ...snapshot,
      appliedRequiredMigrations: [REQUIRED_MIGRATIONS[0]],
      functions: { registerInsertedAsset: false, sourceRuntimePatchGate: true },
    }, {
      environment: "local",
      executionHost: "dev-host",
      databaseTarget: "docker:supabase-db",
      applicationCommit: "abc123",
      generatedAt: "2026-09-03T00:00:00.000Z",
    });

    expect(plan.decision.localDryRunReady).toBe(false);
    expect(plan.decision.targetSchemaReady).toBe(false);
    expect(plan.decision.blockers).toContain(`missing-target-migration:${REQUIRED_MIGRATIONS[1]}`);
    expect(plan.decision.blockers).toContain("required-target-database-functions-missing");
  });

  it("treats a production read-only capture as inventory, not deployment approval", () => {
    const plan = buildCoursewareWorkspaceRolloutPlan(snapshot, {
      environment: "production",
      executionHost: "xiaomi",
      databaseTarget: "ssh:xiaomi/docker:supabase-db",
      applicationCommit: "abc123",
      generatedAt: "2026-09-03T00:00:00.000Z",
    });

    expect(plan.target).toEqual(expect.objectContaining({
      environment: "production",
      executionHost: "xiaomi",
      readOnly: true,
    }));
    expect(plan.decision.localDryRunReady).toBe(false);
    expect(plan.decision.targetSchemaReady).toBe(true);
    expect(plan.decision.productionInventoryCaptured).toBe(true);
    expect(plan.decision.productionCandidateReady).toBe(false);
    expect(plan.decision.blockers).not.toContain("production-read-only-inventory-not-captured");
    expect(plan.decision.blockers).toEqual(["product-owner-production-candidate-approval-pending"]);
  });
});
