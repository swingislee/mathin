const REQUIRED_MIGRATIONS = [
  "20260902000900_courseware_source_runtime_drafts",
  "20260903000700_courseware_page_insertions",
];

const FORMAL_EDITABLE_DOC_VERSIONS = new Set(["page-doc-v1", "source-runtime-page-v1"]);
const INSERTABLE_DOC_VERSIONS = new Set(["page-doc-v1", "source-runtime-page-v1"]);

function integer(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function rows(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function sum(groups, predicate, field) {
  return groups.reduce((total, group) => (
    predicate(group) ? total + integer(group[field], `${field}`) : total
  ), 0);
}

/** Build a write-free rollout decision from one read-only database snapshot. */
export function buildCoursewareWorkspaceRolloutPlan(snapshot, context) {
  if (!snapshot || typeof snapshot !== "object") throw new Error("snapshot must be an object");
  const pageGroups = rows(snapshot.pageGroups, "pageGroups");
  const trackGroups = rows(snapshot.trackGroups, "trackGroups");
  const bindingGroups = rows(snapshot.bindingGroups, "bindingGroups");
  const releaseGroups = rows(snapshot.releaseGroups, "releaseGroups");
  const applied = new Set(rows(snapshot.appliedRequiredMigrations, "appliedRequiredMigrations"));
  const missingMigrations = REQUIRED_MIGRATIONS.filter((version) => !applied.has(version));

  const logicalPages = sum(pageGroups, () => true, "pages");
  const formalEditablePages = sum(
    pageGroups,
    (group) => FORMAL_EDITABLE_DOC_VERSIONS.has(group.docVersion),
    "pages",
  );
  const formalTrackHeads = sum(
    trackGroups,
    (group) => FORMAL_EDITABLE_DOC_VERSIONS.has(group.docVersion),
    "trackHeads",
  );
  const insertableTrackHeads = sum(
    trackGroups,
    (group) => INSERTABLE_DOC_VERSIONS.has(group.docVersion),
    "trackHeads",
  );
  const excludedGroups = trackGroups
    .filter((group) => !FORMAL_EDITABLE_DOC_VERSIONS.has(group.docVersion))
    .map((group) => ({
      sourceSystem: group.sourceSystem,
      track: group.track,
      docVersion: group.docVersion,
      trackHeads: integer(group.trackHeads, "trackHeads"),
      reason: group.docVersion === "courseware-composition-v1"
        ? "teacher-microcourse-adapter-is-deployed-separately"
        : "unsupported-or-legacy-document-version",
    }));
  const currentReleaseCount = releaseGroups.reduce(
    (total, group) => total + integer(group.releases, "releases"),
    0,
  );
  const frozenSessionCount = integer(snapshot.frozenSessionCount, "frozenSessionCount");
  const functionsReady = snapshot.functions?.registerInsertedAsset === true
    && snapshot.functions?.sourceRuntimePatchGate === true;
  const targetSchemaReady = missingMigrations.length === 0 && functionsReady;
  const blockers = [
    ...missingMigrations.map((version) => `missing-target-migration:${version}`),
    ...(!functionsReady ? ["required-target-database-functions-missing"] : []),
    ...(context.environment === "production" ? [] : ["production-read-only-inventory-not-captured"]),
    "product-owner-production-candidate-approval-pending",
  ];

  return {
    schemaVersion: "mathin-courseware-workspace-rollout-v1",
    generatedAt: context.generatedAt,
    target: {
      environment: context.environment,
      executionHost: context.executionHost,
      databaseTarget: context.databaseTarget,
      readOnly: true,
      databaseFingerprint: snapshot.databaseFingerprint ?? null,
      migrationHead: snapshot.migrationHead,
    },
    inventory: {
      logicalPages,
      formalEditablePages,
      formalTrackHeads,
      insertableTrackHeads,
      pageGroups,
      trackGroups,
      bindingGroups,
      releaseGroups,
      currentReleaseCount,
      frozenSessionCount,
      excludedGroups,
    },
    rollout: {
      applicationCommit: context.applicationCommit,
      requiredMigrations: REQUIRED_MIGRATIONS.map((version) => ({
        version,
        appliedOnTarget: applied.has(version),
      })),
      existingPageRowsToRewrite: 0,
      existingBindingsToRewrite: 0,
      storageObjectsToPreupload: 0,
      insertionPersistence: "on-demand-only",
      releaseHeadsAdvancedByMigration: 0,
      frozenSessionsMutatedByMigration: 0,
      failureIsolation: {
        excludedGroups,
        unknownDocumentVersions: "fail-closed",
        sourceProducerNodes: "immutable",
        assetRegistration: "page-capability-gated",
        unsupportedGamesAndTools: "disabled-until-versioned-persistence-contract",
      },
      timeBudgetMinutes: {
        databaseMigrations: 5,
        applicationRollout: 15,
        readOnlyPostflight: 10,
        total: 30,
      },
      rollback: {
        application: "switch-to-previous-release",
        database: "leave-additive-RPCs-in-place; restore prior save function only if postflight detects validator drift",
        pageData: "not-required-no-page-backfill",
        storage: "not-required-no-preupload",
      },
    },
    decision: {
      targetSchemaReady,
      localDryRunReady: context.environment === "local" && targetSchemaReady,
      productionInventoryCaptured: context.environment === "production",
      productionCandidateReady: blockers.length === 0,
      blockers,
    },
  };
}

export { REQUIRED_MIGRATIONS };
