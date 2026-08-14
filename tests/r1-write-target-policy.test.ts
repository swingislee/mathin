import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertControlledContentWriteTarget,
  assertNonProductionWriteTarget,
  R1_WRITE_TARGET_POLICY,
} from "../scripts/lib/r1-write-target-policy.mjs";

const root = process.cwd();
const unregisteredFingerprint = "a".repeat(64);

function localSupabaseEnvironment(overrides: Record<string, string> = {}) {
  return {
    MATHIN_WRITE_TARGET_ENVIRONMENT: "development",
    MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN: "http://127.0.0.1:54321",
    ...overrides,
  };
}

function productionEnvironment(overrides: Record<string, string> = {}) {
  return {
    MATHIN_WRITE_TARGET_ENVIRONMENT: "production",
    MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN: R1_WRITE_TARGET_POLICY.productionSupabaseOrigin,
    MATHIN_WRITE_ALLOWED_SSH_TARGET: R1_WRITE_TARGET_POLICY.productionSshTarget,
    MATHIN_WRITE_TARGET_FINGERPRINT: R1_WRITE_TARGET_POLICY.productionTargetFingerprint,
    ...overrides,
  };
}

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("R1-Live production write target policy", () => {
  it("allows an explicitly attested loopback Supabase target", () => {
    expect(assertNonProductionWriteTarget({
      operation: "fixture",
      supabaseUrl: "http://127.0.0.1:54321",
      environment: localSupabaseEnvironment(),
    })).toMatchObject({
      environment: "development",
      mode: "non-production",
      fingerprint: null,
      targets: { supabaseOrigin: "http://127.0.0.1:54321" },
    });
  });

  it("rejects production origins regardless of case, trailing dot, or a fake development attestation", () => {
    for (const target of [
      "https://supabase.mathin.club",
      "https://SUPABASE.MATHIN.CLUB",
      "https://supabase.mathin.club.",
      "https://mathin.club",
    ]) {
      expect(() => assertNonProductionWriteTarget({
        operation: "fixture",
        supabaseUrl: target,
        environment: {
          MATHIN_WRITE_TARGET_ENVIRONMENT: "development",
          MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN: target,
          MATHIN_WRITE_TARGET_FINGERPRINT: unregisteredFingerprint,
        },
      })).toThrow(/PRODUCTION_TARGET_BLOCKED/);
    }
  });

  it("does not trust private-network routing or an arbitrary fingerprint", () => {
    expect(() => assertNonProductionWriteTarget({
      operation: "fixture",
      supabaseUrl: "http://192.168.50.8:8000",
      environment: {
        MATHIN_WRITE_TARGET_ENVIRONMENT: "development",
        MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN: "http://192.168.50.8:8000",
        MATHIN_WRITE_TARGET_FINGERPRINT: unregisteredFingerprint,
      },
    })).toThrow(/UNREGISTERED_REMOTE_TARGET/);
  });

  it("requires an explicit environment and exact selected target", () => {
    expect(() => assertNonProductionWriteTarget({
      operation: "fixture",
      supabaseUrl: "http://127.0.0.1:54321",
      environment: {},
    })).toThrow(/MATHIN_WRITE_TARGET_ENVIRONMENT/);
    expect(() => assertNonProductionWriteTarget({
      operation: "fixture",
      supabaseUrl: "http://127.0.0.1:54321",
      environment: localSupabaseEnvironment({
        MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN: "http://localhost:54321",
      }),
    })).toThrow(/ATTESTATION_MISMATCH/);
    expect(() => assertNonProductionWriteTarget({
      operation: "fixture",
      supabaseUrl: "http://127.0.0.1:54321",
      environment: localSupabaseEnvironment({ MATHIN_WRITE_TARGET_ENVIRONMENT: "production" }),
    })).toThrow(/PRODUCTION_TARGET_BLOCKED/);
  });

  it("requires attestation for every alternate Storage upload origin", () => {
    expect(() => assertNonProductionWriteTarget({
      operation: "courseware-import",
      supabaseUrl: "http://127.0.0.1:54321",
      additionalSupabaseUrls: ["http://127.0.0.1:8000"],
      environment: localSupabaseEnvironment(),
    })).toThrow(/ATTESTATION_MISMATCH/);
    expect(assertNonProductionWriteTarget({
      operation: "courseware-import",
      supabaseUrl: "http://127.0.0.1:54321",
      additionalSupabaseUrls: ["http://127.0.0.1:8000"],
      environment: localSupabaseEnvironment({
        MATHIN_WRITE_ALLOWED_SUPABASE_ORIGINS: "http://127.0.0.1:54321,http://127.0.0.1:8000",
        MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN: "",
      }),
    }).targets.supabaseOrigins).toEqual([
      "http://127.0.0.1:54321",
      "http://127.0.0.1:8000",
    ]);
  });

  it("permanently rejects Xiaomi and its production fingerprints from fixture/rebuild policy", () => {
    expect(() => assertNonProductionWriteTarget({
      operation: "fixture",
      sshHost: "xiaomi",
      environment: {
        MATHIN_WRITE_TARGET_ENVIRONMENT: "development",
        MATHIN_WRITE_ALLOWED_SSH_TARGET: "xiaomi",
        MATHIN_WRITE_TARGET_FINGERPRINT: unregisteredFingerprint,
      },
    })).toThrow(/PRODUCTION_TARGET_BLOCKED/);

    for (const productionFingerprint of [
      R1_WRITE_TARGET_POLICY.productionTargetFingerprint,
      R1_WRITE_TARGET_POLICY.productionEvidenceFingerprint,
    ]) {
      expect(() => assertNonProductionWriteTarget({
        operation: "fixture",
        supabaseUrl: "http://127.0.0.1:54321",
        environment: localSupabaseEnvironment({
          MATHIN_WRITE_TARGET_FINGERPRINT: productionFingerprint,
        }),
      })).toThrow(/PRODUCTION_TARGET_BLOCKED/);
    }
  });

  it("keeps controlled production content writes fail-closed without both runtime controls", () => {
    const common = {
      operation: "cw:import",
      supabaseUrl: R1_WRITE_TARGET_POLICY.productionSupabaseOrigin,
      sshHost: R1_WRITE_TARGET_POLICY.productionSshTarget,
      environment: productionEnvironment(),
    } as const;
    expect(() => assertControlledContentWriteTarget(common)).toThrow(/PRODUCTION_AUTHORIZATION_REQUIRED/);
    expect(() => assertControlledContentWriteTarget({
      ...common,
      allowProduction: true,
    })).toThrow(/PRODUCTION_AUTHORIZATION_REQUIRED/);
    expect(() => assertControlledContentWriteTarget({
      ...common,
      allowProduction: true,
      productionConfirmation: "cw:import:wrong-target",
    })).toThrow(/PRODUCTION_AUTHORIZATION_REQUIRED/);
  });

  it("allows only the exact registered production content target after explicit per-run authorization", () => {
    const result = assertControlledContentWriteTarget({
      operation: "cw:import",
      supabaseUrl: R1_WRITE_TARGET_POLICY.productionSupabaseOrigin,
      sshHost: R1_WRITE_TARGET_POLICY.productionSshTarget,
      environment: productionEnvironment(),
      allowProduction: true,
      productionConfirmation: R1_WRITE_TARGET_POLICY.productionConfirmationFor("cw:import"),
    });
    expect(result).toMatchObject({
      environment: "production",
      mode: "controlled-production",
      fingerprint: R1_WRITE_TARGET_POLICY.productionTargetFingerprint,
    });

    expect(() => assertControlledContentWriteTarget({
      operation: "cw:import",
      supabaseUrl: R1_WRITE_TARGET_POLICY.productionSupabaseOrigin,
      sshHost: "another-host",
      environment: productionEnvironment({ MATHIN_WRITE_ALLOWED_SSH_TARGET: "another-host" }),
      allowProduction: true,
      productionConfirmation: R1_WRITE_TARGET_POLICY.productionConfirmationFor("cw:import"),
    })).toThrow(/PRODUCTION_TARGET_MISMATCH/);

    expect(() => assertControlledContentWriteTarget({
      operation: "cw:import",
      supabaseUrl: R1_WRITE_TARGET_POLICY.productionSupabaseOrigin,
      additionalSupabaseUrls: ["http://192.168.5.2:8000"],
      sshHost: R1_WRITE_TARGET_POLICY.productionSshTarget,
      environment: productionEnvironment({
        MATHIN_WRITE_ALLOWED_SUPABASE_ORIGINS: `${R1_WRITE_TARGET_POLICY.productionSupabaseOrigin},http://192.168.5.2:8000`,
        MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN: "",
      }),
      allowProduction: true,
      productionConfirmation: R1_WRITE_TARGET_POLICY.productionConfirmationFor("cw:import"),
    })).toThrow(/PRODUCTION_TARGET_MISMATCH/);
  });

  it("does not create a generic production escape hatch for fixture or rebuild operations", () => {
    expect(() => assertControlledContentWriteTarget({
      operation: "fixture",
      supabaseUrl: R1_WRITE_TARGET_POLICY.productionSupabaseOrigin,
      sshHost: R1_WRITE_TARGET_POLICY.productionSshTarget,
      environment: productionEnvironment(),
      allowProduction: true,
      productionConfirmation: "fixture:anything",
    })).toThrow(/PRODUCTION_OPERATION_BLOCKED/);
  });

  it("allows the attested disposable CI database and does not echo database credentials", () => {
    expect(assertNonProductionWriteTarget({
      operation: "ci-db-rebuild",
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      environment: {
        MATHIN_WRITE_TARGET_ENVIRONMENT: "test",
        MATHIN_WRITE_ALLOWED_DATABASE_TARGET: "127.0.0.1:5432/postgres",
      },
    }).targets.databaseTarget).toBe("127.0.0.1:5432/postgres");

    expect(() => assertNonProductionWriteTarget({
      operation: "ci-db-rebuild",
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:5432/not-the-ci-database",
      environment: {
        MATHIN_WRITE_TARGET_ENVIRONMENT: "test",
        MATHIN_WRITE_ALLOWED_DATABASE_TARGET: "127.0.0.1:5432/postgres",
      },
    })).toThrow(/ATTESTATION_MISMATCH/);

    expect(() => assertNonProductionWriteTarget({
      operation: "ci-db-rebuild",
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:5432/postgres?host=xiaomi",
      environment: {
        MATHIN_WRITE_TARGET_ENVIRONMENT: "test",
        MATHIN_WRITE_ALLOWED_DATABASE_TARGET: "127.0.0.1:5432/postgres",
      },
    })).toThrow(/INVALID_TARGET/);

    let message = "";
    const redactedCredentialUrl = [
      "postgresql://postgres",
      "do-not-echo@db.example.test:5432/postgres",
    ].join(":");
    try {
      assertNonProductionWriteTarget({
        operation: "ci-db-rebuild",
        databaseUrl: redactedCredentialUrl,
        environment: { MATHIN_WRITE_TARGET_ENVIRONMENT: "test" },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("do-not-echo");
  });

  it("guards every writer before its first remote write primitive", () => {
    const cases = [
      ["scripts/ensure-r1-family-test-fixtures.mjs", "assertNonProductionWriteTarget({", "const admin = createClient"],
      ["scripts/ensure-r1-family-journey-fixture.mjs", "assertNonProductionWriteTarget({", "const admin = createClient"],
      ["scripts/ensure-r1-manual-test-dataset.mjs", "assertNonProductionWriteTarget({", "const admin = createClient"],
      ["scripts/p4e-offline-fixture.mjs", "assertNonProductionWriteTarget({", "const admin = createClient"],
      ["scripts/ci-rebuild-db.mjs", "assertNonProductionWriteTarget({", 'spawnSync("psql"'],
      ["scripts/cw-import.mjs", "assertControlledContentWriteTarget({", "const client = createClient"],
      ["scripts/cw-adapt-4x3.mjs", "assertControlledContentWriteTarget({", "const storage = await uploadDerivedObjects"],
    ] as const;

    for (const [relativePath, guardCall, firstWrite] of cases) {
      const source = read(relativePath);
      const guard = source.lastIndexOf(guardCall);
      expect(guard, `${relativePath} imports/calls the shared guard`).toBeGreaterThan(-1);
      expect(source.indexOf(firstWrite), `${relativePath} retains its write primitive`).toBeGreaterThan(-1);
      expect(guard, `${relativePath} guards before its write primitive`).toBeLessThan(source.indexOf(firstWrite));
    }
  });

  it("requires an explicit CLI switch and current-Shell confirmation for production content tools", () => {
    for (const relativePath of ["scripts/cw-import.mjs", "scripts/cw-adapt-4x3.mjs"]) {
      const source = read(relativePath);
      expect(source).toContain('arg === "--allow-production-target"');
      expect(source).toContain("process.env.MATHIN_PRODUCTION_WRITE_CONFIRMATION");
    }
    const batch = read("scripts/aixuexi-import-all.mjs");
    expect(batch).toContain('arg === "--allow-production-target"');
    expect(batch).toContain('args.push("--allow-production-target")');
  });

  it("keeps the checked-in environment example local and the CI rebuild explicitly attested", () => {
    const example = read(".env.example");
    expect(example).toContain("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321");
    expect(example).not.toMatch(/^NEXT_PUBLIC_SUPABASE_URL=https:\/\/supabase\.mathin\.club$/m);
    expect(example).toContain("MATHIN_WRITE_TARGET_ENVIRONMENT=development");
    expect(example).toContain("MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN=http://127.0.0.1:54321");
    expect(example).not.toContain("MATHIN_PRODUCTION_WRITE_CONFIRMATION=");

    const workflow = read(".github/workflows/ci.yml");
    expect(workflow).toContain("MATHIN_WRITE_TARGET_ENVIRONMENT: test");
    expect(workflow).toContain('MATHIN_WRITE_ALLOWED_DATABASE_TARGET: "127.0.0.1:5432/postgres"');
  });
});
