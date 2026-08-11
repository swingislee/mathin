import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProductionBaselinePlan,
  loadProductionBaselineContext,
  validateProductionBaselineResult,
} from "../scripts/plan-r1-production-baseline.mjs";

const root = process.cwd();
const manifestPath = "docs/manifests/r1-production-baseline.example.json";
const schemaPath = path.join(root, "schemas", "r1-production-baseline-manifest.schema.json");
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const expectedCounts = {
  courseCount: 94,
  lectureCount: 1187,
  nativeHeadCount: 1187,
  adaptedHeadCount: 1187,
  releaseCount: 2374,
  legacyCurrentReleaseCount: 1187,
  releaseNoGreaterThanOneCount: 0,
};

function writeManifest(temp: string, name: string, value: Record<string, unknown>) {
  value.$schema = schemaPath;
  const target = path.join(temp, name);
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

function resultFor(
  context: ReturnType<typeof loadProductionBaselineContext>,
  stage: "post_apply" | "second_run",
  changes: { inserted: number; updated: number; deleted: number; hashDifferences: number },
) {
  return {
    schemaVersion: "mathin-r1-production-baseline-result-v1",
    stage,
    manifestHash: context.manifestHash,
    target: clone(context.manifest.target),
    stateHash: "7".repeat(64),
    courseSystems: context.courseSystems.map((system) => ({
      key: system.key,
      lectureIdsSha256: system.lectureIdsSha256,
      storageObjectsManifestSha256: system.storage.objectsManifestSha256,
    })),
    counts: { ...expectedCounts },
    changes,
  };
}

describe("R1-15 production baseline read-only planner", () => {
  it("builds the same plan and plan hash for the same explicit 1187-lecture input", () => {
    const firstContext = loadProductionBaselineContext({ root, manifestPath });
    const secondContext = loadProductionBaselineContext({ root, manifestPath });
    const first = buildProductionBaselinePlan(firstContext);
    const second = buildProductionBaselinePlan(secondContext);

    expect(first).toEqual(second);
    expect(first.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.mode).toBe("plan-only");
    expect(first.writesAllowed).toBe(false);
    expect(first.target.environment).toBe("isolated-production-snapshot");
    expect(first.guards).toMatchObject({
      networkAllowed: false,
      databaseConnectionAllowed: false,
      sqlGenerationAllowed: false,
      productionWriteTargetAllowed: false,
    });
    expect(first.baseline.expected).toEqual(expectedCounts);
    expect(first.baseline.courseSystems).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "e-series", courseCount: 90, lectureCount: 1135, releaseCount: 2270 }),
      expect.objectContaining({ key: "aixuexi-gplus-autumn", courseCount: 4, lectureCount: 52, releaseCount: 104 }),
    ]));
    expect(JSON.stringify(first)).not.toContain("example-e-0001");
    expect(JSON.stringify(first)).not.toContain("manifestPath");
  });

  it("rejects production targets, writable plans, equal source/target fingerprints, and endpoint fields", () => {
    const source = readJson(manifestPath);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-baseline-"));
    try {
      const productionTarget = clone(source);
      productionTarget.target.environment = "production";
      expect(() => loadProductionBaselineContext({ root, manifestPath: writeManifest(temp, "production.json", productionTarget) }))
        .toThrow(/target\.environment must be isolated-production-snapshot/);

      const writable = clone(source);
      writable.writesAllowed = true;
      expect(() => loadProductionBaselineContext({ root, manifestPath: writeManifest(temp, "writable.json", writable) }))
        .toThrow(/writesAllowed must be false/);

      const sameTarget = clone(source);
      sameTarget.target.projectFingerprint = sameTarget.source.projectFingerprint;
      expect(() => loadProductionBaselineContext({ root, manifestPath: writeManifest(temp, "same-target.json", sameTarget) }))
        .toThrow(/project fingerprints must differ/);

      const endpoint = clone(source);
      endpoint.target.endpoint = "https://example.invalid";
      expect(() => loadProductionBaselineContext({ root, manifestPath: writeManifest(temp, "endpoint.json", endpoint) }))
        .toThrow(/must not describe credentials, connections, URLs, or endpoints/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("requires complete sorted explicit IDs, matching set hashes, Storage descriptors, and administrator hash", () => {
    const source = readJson(manifestPath);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-baseline-"));
    try {
      const missingLecture = clone(source);
      missingLecture.courseSystems[0].lectureIds.pop();
      expect(() => loadProductionBaselineContext({ root, manifestPath: writeManifest(temp, "missing-lecture.json", missingLecture) }))
        .toThrow(/exactly 1135 IDs/);

      const setHashDrift = clone(source);
      setHashDrift.courseSystems[1].lectureIdsSha256 = "0".repeat(64);
      expect(() => loadProductionBaselineContext({ root, manifestPath: writeManifest(temp, "set-hash.json", setHashDrift) }))
        .toThrow(/does not match the explicit ID set/);

      const unsafePrefix = clone(source);
      unsafePrefix.courseSystems[0].storage.prefix = "../*/";
      expect(() => loadProductionBaselineContext({ root, manifestPath: writeManifest(temp, "prefix.json", unsafePrefix) }))
        .toThrow(/explicit relative prefix/);

      const adminHashDrift = clone(source);
      adminHashDrift.administrator.manifestSha256 = "0".repeat(64);
      expect(() => loadProductionBaselineContext({ root, manifestPath: writeManifest(temp, "admin-hash.json", adminHashDrift) }))
        .toThrow(/administrator manifest hash mismatch/);

      const actualIdsRequired = clone(source);
      actualIdsRequired.example = false;
      expect(() => loadProductionBaselineContext({ root, manifestPath: writeManifest(temp, "actual-ids.json", actualIdsRequired) }))
        .toThrow(/production-snapshot IDs must be UUIDs/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("accepts one post-apply inventory and only an identical zero-difference second run", () => {
    const context = loadProductionBaselineContext({ root, manifestPath });
    const postApply = resultFor(context, "post_apply", {
      inserted: 2374,
      updated: 2374,
      deleted: 19,
      hashDifferences: 0,
    });
    const secondRun = resultFor(context, "second_run", {
      inserted: 0,
      updated: 0,
      deleted: 0,
      hashDifferences: 0,
    });

    expect(validateProductionBaselineResult(context, postApply).stage).toBe("post_apply");
    expect(validateProductionBaselineResult(context, secondRun, postApply)).toMatchObject({
      status: "passed",
      stage: "second_run",
      replayNoOp: true,
    });

    const changedReplay = clone(secondRun);
    changedReplay.changes.updated = 1;
    expect(() => validateProductionBaselineResult(context, changedReplay, postApply)).toThrow(/changes\.updated must be 0/);

    const changedState = clone(secondRun);
    changedState.stateHash = "8".repeat(64);
    expect(() => validateProductionBaselineResult(context, changedState, postApply)).toThrow(/state hash differs/);

    const wrongCount = clone(postApply);
    wrongCount.counts.releaseCount = 1834;
    expect(() => validateProductionBaselineResult(context, wrongCount)).toThrow(/releaseCount must be 2374/);

    const postApplyHashDrift = clone(postApply);
    postApplyHashDrift.changes.hashDifferences = 1;
    expect(() => validateProductionBaselineResult(context, postApplyHashDrift)).toThrow(/hashDifferences must be 0/);
  });

  it("ships a strict current-count schema without network, database, or process execution code", () => {
    const schema = readJson("schemas/r1-production-baseline-manifest.schema.json");
    const source = fs.readFileSync(path.join(root, "scripts", "plan-r1-production-baseline.mjs"), "utf8");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.target.properties.environment.const).toBe("isolated-production-snapshot");
    expect(schema.properties.writesAllowed.const).toBe(false);
    expect(schema.properties.expected.properties).toMatchObject({
      courseCount: { const: 94 },
      lectureCount: { const: 1187 },
      releaseCount: { const: 2374 },
    });
    expect(source).not.toMatch(/from ["']node:(?:http|https|net|tls|child_process)["']/);
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("DATABASE_URL");
    expect(source).not.toContain("SUPABASE_");
  });
});
