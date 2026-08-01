import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInitializationPlan,
  loadInitializationContext,
  validateInitializationInventory,
} from "../scripts/plan-r1-initialization.mjs";

const root = process.cwd();
const manifestPath = "docs/manifests/r1-initialization.example.json";
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function uuidAt(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function resourceKeys(context: ReturnType<typeof loadInitializationContext>) {
  return new Map([
    ["course_catalog", context.courseKeys],
    ["organization_rules", context.configuration.get("organization_rules")!.expectedKeys],
    ["feature_flags", context.configuration.get("feature_flags")!.expectedKeys],
  ]);
}

function inventoryFor(context: ReturnType<typeof loadInitializationContext>, stage: "preflight" | "post_apply") {
  let id = 1;
  return {
    schemaVersion: "mathin-r1-initialization-inventory-v1",
    stage,
    manifestHash: context.manifestHash,
    migration: {
      head: context.manifest.migration.head,
      digest: context.manifest.migration.digest,
    },
    resources: [...resourceKeys(context)].map(([kind, keys]) => {
      const items = stage === "preflight" ? [] : keys.map((naturalKey: string) => ({ naturalKey, id: uuidAt(id++) }));
      return { kind, reportedCount: items.length, items };
    }),
  };
}

describe("R1-7B initialization manifest", () => {
  it("builds one deterministic, read-only plan from natural keys", () => {
    const firstContext = loadInitializationContext({ root, manifestPath });
    const secondContext = loadInitializationContext({ root, manifestPath });
    const first = buildInitializationPlan(firstContext);
    const second = buildInitializationPlan(secondContext);

    expect(first).toEqual(second);
    expect(first.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.guards.writesAllowed).toBe(false);
    expect(first.guards.idStrategy).toBe("database-generated");
    expect(first.guards.productionExecutionStage).toContain("R1-15/R1-18");
    expect(first.phases.find((phase) => phase.kind === "course_catalog")).toMatchObject({
      naturalKey: "productCode",
      expectedCount: 72,
      expectedChildCount: 865,
    });
    expect(JSON.stringify(first)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it("stops on source hash drift and UUID-bearing desired-state manifests", () => {
    const source = readJson(manifestPath);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mathin-r1-init-"));
    const schemaPath = path.join(root, "schemas", "r1-initialization-manifest.schema.json");
    try {
      const hashDrift = clone(source);
      hashDrift.$schema = schemaPath;
      hashDrift.referenceData.sourceSha256 = "0".repeat(64);
      const hashDriftPath = path.join(temp, "hash-drift.json");
      fs.writeFileSync(hashDriftPath, JSON.stringify(hashDrift), "utf8");
      expect(() => loadInitializationContext({ root, manifestPath: hashDriftPath })).toThrow(/reference data source hash mismatch/);

      const uuidManifest = clone(source);
      uuidManifest.$schema = schemaPath;
      uuidManifest.projectId = "00000000-0000-4000-8000-000000000123";
      const uuidPath = path.join(temp, "uuid.json");
      fs.writeFileSync(uuidPath, JSON.stringify(uuidManifest), "utf8");
      expect(() => loadInitializationContext({ root, manifestPath: uuidPath })).toThrow(/must not contain UUIDs/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it("requires a clean preflight inventory and exact post-apply counts", () => {
    const context = loadInitializationContext({ root, manifestPath });
    const clean = inventoryFor(context, "preflight");
    expect(validateInitializationInventory(context, clean).counts).toEqual({
      course_catalog: 0,
      organization_rules: 0,
      feature_flags: 0,
    });

    const dirty = clone(clean);
    dirty.resources[0].items.push({ naturalKey: "unexpected", id: uuidAt(999) });
    dirty.resources[0].reportedCount = 1;
    expect(() => validateInitializationInventory(context, dirty)).toThrow(/preflight count must be 0/);

    const postApply = inventoryFor(context, "post_apply");
    expect(validateInitializationInventory(context, postApply).counts).toEqual({
      course_catalog: 72,
      organization_rules: 6,
      feature_flags: 5,
    });
  });

  it("stops when a replay changes any database-generated ID", () => {
    const context = loadInitializationContext({ root, manifestPath });
    const baseline = inventoryFor(context, "post_apply");
    const repeated = clone(baseline);
    expect(validateInitializationInventory(context, repeated, baseline).baselineMatched).toBe(true);

    repeated.resources[0].items[0].id = uuidAt(999);
    expect(() => validateInitializationInventory(context, repeated, baseline)).toThrow(/ID mapping differs/);
  });

  it("ships a strict JSON schema and active planning contract", () => {
    const schema = readJson("schemas/r1-initialization-manifest.schema.json");
    const plan = fs.readFileSync(path.join(root, "docs", "plan", "25-production-1.0-product-completeness.md"), "utf8");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.schemaVersion.const).toBe("mathin-r1-initialization-v1");
    expect(schema.properties.mode.const).toBe("plan-only");
    expect(plan).toContain("R1-7B 初始化 manifest");
  });
});